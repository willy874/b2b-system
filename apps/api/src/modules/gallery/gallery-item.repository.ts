import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database, DbOrTx } from '@/core/database';
import { containsPattern, TENANT_DB } from '@/core/database';
import { RESOURCE_TYPE } from '@/core/resource';
import { addStorageUsage, readStorageUsage, reserveStorageUsage } from '@/core/usage';
import {
  galleryAlbumItems,
  galleryAlbums,
  galleryItems,
  hasAnyTag,
  isDeleted,
  notDeleted,
  users,
} from '@/db/schema';
import type {
  GalleryExif,
  GalleryItemInsert,
  GalleryItemRow,
  GalleryItemVariants,
} from '@/db/schema';

import type { GalleryCursor, GallerySortField, GallerySortOrder } from './gallery.cursor';

/** 列表、時間軸、上一張／下一張共用的篩選（已驗證過的值）。 */
export interface GalleryItemFilter {
  keyword?: string;
  albumId?: string;
  tagIds?: readonly string[];
  takenFrom?: Date;
  takenTo?: Date;
  orientation?: 'landscape' | 'portrait' | 'square';
  uploaderId?: string;
  origin?: 'upload' | 'added';
  /** 選圖：用途收的型別與大小上限。 */
  usage?: { contentTypes: readonly string[]; maxSize: number };
}

export interface GallerySort {
  field: GallerySortField;
  order: GallerySortOrder;
}

/** 列表的一列：排序值以資料庫格式化的微秒字串帶出（游標用，JS 的 Date 只有毫秒）。 */
export interface GalleryItemListRow extends GalleryItemRow {
  sortValue: string;
}

/** 原檔寫好之後寫回的描述（處理的第一步）。 */
export interface GalleryOriginalValues {
  contentType: string;
  /** 原檔（移除位置資訊之後）的大小；與登記的大小的差額在同一個交易內補進租戶的已用量。 */
  size: number;
  width: number;
  height: number;
  contentHash: string;
  exif: GalleryExif | null;
  takenAt: Date | null;
  locationStripped: boolean;
  dominantColor: string;
  variantFormat: string;
}

const deleter = alias(users, 'gallery_item_deleter');

/** 顯示的寬高（套用 `display_rotation` 之後）。 */
const DISPLAY_WIDTH = sql`CASE WHEN ${galleryItems.displayRotation} IN (90, 270) THEN ${galleryItems.height} ELSE ${galleryItems.width} END`;
const DISPLAY_HEIGHT = sql`CASE WHEN ${galleryItems.displayRotation} IN (90, 270) THEN ${galleryItems.width} ELSE ${galleryItems.height} END`;

/** 正方形：寬高差在 1% 以內。 */
const ORIENTATION_CONDITION: Record<NonNullable<GalleryItemFilter['orientation']>, SQL> = {
  landscape: sql`${DISPLAY_WIDTH} > ${DISPLAY_HEIGHT} * 1.01`,
  portrait: sql`${DISPLAY_HEIGHT} > ${DISPLAY_WIDTH} * 1.01`,
  square: sql`${DISPLAY_WIDTH} <= ${DISPLAY_HEIGHT} * 1.01 AND ${DISPLAY_HEIGHT} <= ${DISPLAY_WIDTH} * 1.01`,
};

const SORT_COLUMN = {
  sortAt: galleryItems.sortAt,
  createdAt: galleryItems.createdAt,
  title: galleryItems.title,
} as const satisfies Record<GallerySortField, unknown>;

function exactValue(field: GallerySortField): SQL<string> {
  if (field === 'title') return sql<string>`${galleryItems.title}`;
  return sql<string>`to_char(${SORT_COLUMN[field]} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

function typedValue(field: GallerySortField, value: string): SQL {
  return field === 'title' ? sql`${value}` : sql`${value}::timestamptz`;
}

/** 排在 `(value, id)` 之後（`after`）或之前的列（依排序的方向）。 */
function beyond(
  field: GallerySortField,
  order: GallerySortOrder,
  value: string,
  id: string,
  after: boolean,
): SQL {
  const column = SORT_COLUMN[field];
  const forward = (order === 'desc') === after;
  return forward
    ? sql`(${column}, ${galleryItems.id}) < (${typedValue(field, value)}, ${id}::uuid)`
    : sql`(${column}, ${galleryItems.id}) > (${typedValue(field, value)}, ${id}::uuid)`;
}

function reverse(order: GallerySortOrder): GallerySortOrder {
  return order === 'desc' ? 'asc' : 'desc';
}

function orderBy(field: GallerySortField, order: GallerySortOrder): SQL[] {
  const direction = order === 'desc' ? desc : asc;
  return [direction(SORT_COLUMN[field]), direction(galleryItems.id)];
}

/**
 * 圖片庫的圖片（docs/architecture/backend/26-gallery.md §3）。已用量（`file_storage_usage`）是租戶的計數：
 * 登記（`create`）、原檔寫好（`setOriginal` 補差額）、刪除（`deleteRows`、`hardDelete`）在同一個交易內增減。
 * 列表一律只看 ready、沒刪除的（`visible`）。
 */
@Injectable()
export class GalleryItemRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  storageUsed(tx?: DbOrTx): Promise<number> {
    return readStorageUsage(tx ?? this.db);
  }

  /** 在容量內登記一筆（在呼叫端的交易內）；超過容量回 undefined，什麼都不寫。 */
  async create(
    values: GalleryItemInsert,
    quota: number,
    tx: DbOrTx,
  ): Promise<GalleryItemRow | undefined> {
    if (!(await reserveStorageUsage(tx, values.size, quota))) return undefined;
    const [row] = await tx.insert(galleryItems).values(values).returning();
    if (!row) throw new Error('建立圖片庫的圖片失敗');
    return row;
  }

  async findById(id: string, tx?: DbOrTx): Promise<GalleryItemRow | undefined> {
    const [row] = await (tx ?? this.db).select().from(galleryItems).where(eq(galleryItems.id, id));
    return row;
  }

  /** 圖片庫裡看得到的一張（ready、沒刪除）。 */
  async findVisible(id: string, tx?: DbOrTx): Promise<GalleryItemRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(galleryItems)
      .where(and(eq(galleryItems.id, id), this.visible()));
    return row;
  }

  async findVisibleByIds(ids: readonly string[], tx?: DbOrTx): Promise<GalleryItemRow[]> {
    if (ids.length === 0) return [];
    return (tx ?? this.db)
      .select()
      .from(galleryItems)
      .where(and(inArray(galleryItems.id, [...ids]), this.visible()));
  }

  async findDeletedById(id: string): Promise<GalleryItemRow | undefined> {
    const [row] = await this.db
      .select()
      .from(galleryItems)
      .where(and(eq(galleryItems.id, id), isDeleted(galleryItems)));
    return row;
  }

  /** 這個人登記了、還沒完成上傳的張數（每人上限）。 */
  async countPending(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(galleryItems)
      .where(and(eq(galleryItems.createdBy, userId), eq(galleryItems.status, 'pending')));
    return row?.count ?? 0;
  }

  /** 完成上傳（pending → processing）；不是 pending 回 false。 */
  async markProcessing(id: string, tx: DbOrTx): Promise<boolean> {
    const rows = await tx
      .update(galleryItems)
      .set({ status: 'processing', queuedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(galleryItems.id, id), eq(galleryItems.status, 'pending')))
      .returning({ id: galleryItems.id });
    return rows.length > 0;
  }

  /** 標記「已排入處理」（清理排程依它判斷卡住的處理）。 */
  async markQueued(id: string, tx?: DbOrTx): Promise<void> {
    await (tx ?? this.db)
      .update(galleryItems)
      .set({ queuedAt: new Date() })
      .where(eq(galleryItems.id, id));
  }

  /** 原檔寫好：只有還沒有原檔的那一次會寫入（重複的工作拿到 false）。 */
  async setOriginal(id: string, values: GalleryOriginalValues, tx: DbOrTx): Promise<boolean> {
    const [before] = await tx
      .select({ size: galleryItems.size })
      .from(galleryItems)
      .where(and(eq(galleryItems.id, id), eq(galleryItems.hasOriginal, false)))
      .for('update');
    if (!before) return false;
    await tx
      .update(galleryItems)
      .set({ ...values, hasOriginal: true, updatedAt: new Date() })
      .where(eq(galleryItems.id, id));
    await addStorageUsage(tx, values.size - before.size);
    return true;
  }

  /**
   * 一個版本的變體寫好：要求的版本仍是 `rev` 才寫入（處理途中又調整了方向，就留給下一個工作）。
   * 原本已經有版本時，舊版本的物件在 `staleRevsPurgeAfter` 之後清掉（網址的效期過了才不會破圖）。
   * 回傳更新後的列與更新前的狀態（第一次 ready 時才寫稽核、推 `create`）。
   */
  async setVariants(
    id: string,
    rev: number,
    variants: GalleryItemVariants,
    placeholder: string | null,
    staleRevsPurgeAfter: Date,
    tx: DbOrTx,
  ): Promise<{ row: GalleryItemRow; wasReady: boolean } | undefined> {
    const [before] = await tx
      .select({ status: galleryItems.status, variantRev: galleryItems.variantRev })
      .from(galleryItems)
      .where(and(eq(galleryItems.id, id), eq(galleryItems.rev, rev)))
      .for('update');
    if (!before || before.status === 'failed') return undefined;
    const [row] = await tx
      .update(galleryItems)
      .set({
        status: 'ready',
        variantRev: rev,
        variants,
        placeholder,
        ...(before.variantRev === null ? {} : { staleRevsPurgeAfter }),
        updatedAt: new Date(),
      })
      .where(eq(galleryItems.id, id))
      .returning();
    return row ? { row, wasReady: before.status === 'ready' } : undefined;
  }

  /** 處理途中又調整了方向：剛寫好的版本沒人用，交給清理排程刪掉。 */
  async scheduleStaleRevsPurge(id: string, at: Date): Promise<void> {
    await this.db
      .update(galleryItems)
      .set({ staleRevsPurgeAfter: at })
      .where(and(eq(galleryItems.id, id), sql`${galleryItems.staleRevsPurgeAfter} IS NULL`));
  }

  /** 只有還沒處理好的會被標成失敗（調整方向失敗時保留原本的版本）。 */
  async markFailed(id: string, reason: string): Promise<GalleryItemRow | undefined> {
    const [row] = await this.db
      .update(galleryItems)
      .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
      .where(and(eq(galleryItems.id, id), inArray(galleryItems.status, ['pending', 'processing'])))
      .returning();
    return row;
  }

  // ── 列表 ──

  async list(
    filter: GalleryItemFilter,
    sort: GallerySort,
    position: { cursor?: GalleryCursor; startAt?: Date },
    limit: number,
  ): Promise<GalleryItemListRow[]> {
    const conditions = this.filterConditions(filter);
    const backward = position.cursor?.direction === 'before';
    if (position.cursor) {
      const { value, id } = position.cursor;
      conditions.push(beyond(sort.field, sort.order, value, id, !backward));
    } else if (position.startAt && sort.field !== 'title') {
      const column = SORT_COLUMN[sort.field];
      conditions.push(
        sort.order === 'desc'
          ? lt(column, position.startAt)
          : sql`${column} >= ${position.startAt.toISOString()}::timestamptz`,
      );
    }
    const rows = await this.db
      .select({ item: galleryItems, sortValue: exactValue(sort.field) })
      .from(galleryItems)
      .where(and(...conditions))
      // 往前取：反向排序取最靠近游標的幾筆（呼叫端倒回原本的順序）
      .orderBy(...orderBy(sort.field, backward ? reverse(sort.order) : sort.order))
      .limit(limit);
    return rows.map(({ item, sortValue }) => Object.assign(item, { sortValue }));
  }

  /** 每個月的張數（`timeZone` 的月份），新到舊。 */
  async timeline(
    filter: GalleryItemFilter,
    field: 'sortAt' | 'createdAt',
    timeZone: string,
  ): Promise<Array<{ month: string; count: number }>> {
    const month = sql<string>`to_char(${SORT_COLUMN[field]} AT TIME ZONE ${timeZone}, 'YYYY-MM')`;
    return (
      this.db
        .select({ month, count: sql<number>`count(*)::int` })
        .from(galleryItems)
        .where(and(...this.filterConditions(filter)))
        // 以位置參照分組：時區是查詢參數，同一個運算式寫兩次會變成兩個不同的參數，Postgres 認不出是同一欄
        .groupBy(sql`1`)
        .orderBy(sql`1 DESC`)
    );
  }

  /** 同一個篩選與排序之下，這一張的前一張與後一張（從分享的網址直接打開檢視器時）。 */
  async neighbors(
    item: GalleryItemRow,
    filter: GalleryItemFilter,
    sort: GallerySort,
  ): Promise<{ previousId: string | null; nextId: string | null }> {
    const [current] = await this.db
      .select({ value: exactValue(sort.field) })
      .from(galleryItems)
      .where(eq(galleryItems.id, item.id));
    if (!current) return { previousId: null, nextId: null };
    const reversed = reverse(sort.order);
    const [next, previous] = await Promise.all([
      this.db
        .select({ id: galleryItems.id })
        .from(galleryItems)
        .where(
          and(
            ...this.filterConditions(filter),
            beyond(sort.field, sort.order, current.value, item.id, true),
          ),
        )
        .orderBy(...orderBy(sort.field, sort.order))
        .limit(1),
      this.db
        .select({ id: galleryItems.id })
        .from(galleryItems)
        .where(
          and(
            ...this.filterConditions(filter),
            beyond(sort.field, sort.order, current.value, item.id, false),
          ),
        )
        .orderBy(...orderBy(sort.field, reversed))
        .limit(1),
    ]);
    return { previousId: previous[0]?.id ?? null, nextId: next[0]?.id ?? null };
  }

  // ── 編輯、刪除、還原 ──

  /** 條件式 UPDATE（樂觀鎖）：顯示方向改變時一併遞增要求的變體版本。 */
  async update(
    id: string,
    fields: { title?: string; description?: string | null; displayRotation?: number },
    rotationChanged: boolean,
    version: number,
    actorId: string,
    tx: DbOrTx,
  ): Promise<GalleryItemRow | undefined> {
    const [row] = await tx
      .update(galleryItems)
      .set({
        ...fields,
        ...(rotationChanged ? { rev: sql`${galleryItems.rev} + 1`, queuedAt: new Date() } : {}),
        version: sql`${galleryItems.version} + 1`,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(and(eq(galleryItems.id, id), eq(galleryItems.version, version), this.visible()))
      .returning();
    return row;
  }

  async findVersion(id: string, tx?: DbOrTx): Promise<number | undefined> {
    const [row] = await (tx ?? this.db)
      .select({ version: galleryItems.version })
      .from(galleryItems)
      .where(and(eq(galleryItems.id, id), this.visible()));
    return row?.version;
  }

  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<GalleryItemRow | undefined> {
    const [row] = await tx
      .update(galleryItems)
      .set({ deletedAt: new Date(), updatedBy: actorId, updatedAt: new Date() })
      .where(and(eq(galleryItems.id, id), this.visible()))
      .returning();
    return row;
  }

  async restore(id: string, actorId: string, tx: DbOrTx): Promise<GalleryItemRow | undefined> {
    const [row] = await tx
      .update(galleryItems)
      .set({ deletedAt: null, updatedBy: actorId, updatedAt: new Date() })
      .where(and(eq(galleryItems.id, id), isDeleted(galleryItems)))
      .returning();
    return row;
  }

  // ── 回收桶 ──

  async listDeleted(query: { offset: number; limit: number; keyword?: string }): Promise<{
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      deletedAt: Date;
      deletedBy: { id: string; name: string } | null;
    }>;
    total: number;
  }> {
    const conditions: SQL[] = [isDeleted(galleryItems)];
    if (query.keyword) {
      conditions.push(sql`${galleryItems.title} ILIKE ${containsPattern(query.keyword)}`);
    }
    const where = and(...conditions);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: galleryItems.id,
          name: galleryItems.title,
          sourceName: galleryItems.sourceName,
          deletedAt: galleryItems.deletedAt,
          deleterId: deleter.id,
          deleterName: deleter.displayName,
        })
        .from(galleryItems)
        .leftJoin(deleter, eq(deleter.id, galleryItems.updatedBy))
        .where(where)
        .orderBy(desc(galleryItems.deletedAt), desc(galleryItems.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(galleryItems)
        .where(where),
    ]);
    return {
      items: rows.flatMap(({ deleterId, deleterName, deletedAt, sourceName, ...row }) =>
        deletedAt
          ? [
              {
                ...row,
                description: sourceName,
                deletedAt,
                deletedBy: deleterId && deleterName ? { id: deleterId, name: deleterName } : null,
              },
            ]
          : [],
      ),
      total: counted?.total ?? 0,
    };
  }

  async findExpired(
    cutoff: Date,
    afterId: string | null,
    limit: number,
  ): Promise<Array<{ id: string; name: string; deletedAt: Date }>> {
    const rows = await this.db
      .select({ id: galleryItems.id, name: galleryItems.title, deletedAt: galleryItems.deletedAt })
      .from(galleryItems)
      .where(
        and(
          isDeleted(galleryItems),
          lt(galleryItems.deletedAt, cutoff),
          afterId ? gt(galleryItems.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(galleryItems.id))
      .limit(limit);
    return rows.flatMap(({ deletedAt, ...row }) => (deletedAt ? [{ ...row, deletedAt }] : []));
  }

  /** 永久刪除一張已刪除的圖片並釋出容量；相簿的關聯隨外鍵 CASCADE 刪除，封面隨 SET NULL 清空。 */
  async hardDelete(id: string, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .delete(galleryItems)
      .where(and(eq(galleryItems.id, id), isDeleted(galleryItems)))
      .returning({ id: galleryItems.id, size: galleryItems.size });
    if (!row) return false;
    await addStorageUsage(tx, -row.size);
    return true;
  }

  // ── 自己的上傳 ──

  async uploadsOf(userId: string): Promise<{ processing: number; failed: GalleryItemRow[] }> {
    const [counted, failed] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(galleryItems)
        .where(
          and(
            eq(galleryItems.createdBy, userId),
            inArray(galleryItems.status, ['pending', 'processing']),
            notDeleted(galleryItems),
          ),
        ),
      this.db
        .select()
        .from(galleryItems)
        .where(
          and(
            eq(galleryItems.createdBy, userId),
            eq(galleryItems.status, 'failed'),
            notDeleted(galleryItems),
          ),
        )
        .orderBy(desc(galleryItems.createdAt))
        .limit(100),
    ]);
    return { processing: counted[0]?.count ?? 0, failed };
  }

  /** 自己處理失敗的紀錄（清掉頁首的失敗清單）；回傳刪到的 id。 */
  async findFailedOf(userId: string, tx: DbOrTx): Promise<string[]> {
    const rows = await tx
      .select({ id: galleryItems.id })
      .from(galleryItems)
      .where(and(eq(galleryItems.createdBy, userId), eq(galleryItems.status, 'failed')));
    return rows.map((row) => row.id);
  }

  // ── 從其他來源加入、重複、相簿 ──

  /** 同一個來源的這些 `refId` 已經在圖片庫（沒刪除、沒失敗）的那一張。 */
  async findBySource(source: string, refIds: readonly string[]): Promise<Map<string, string>> {
    if (refIds.length === 0) return new Map();
    const rows = await this.db
      .select({ refId: galleryItems.sourceRefId, id: galleryItems.id })
      .from(galleryItems)
      .where(
        and(
          eq(galleryItems.source, source),
          inArray(galleryItems.sourceRefId, [...refIds]),
          notDeleted(galleryItems),
          ne(galleryItems.status, 'failed'),
        ),
      );
    return new Map(rows.flatMap((row) => (row.refId ? [[row.refId, row.id]] : [])));
  }

  /** 內容相同的其他圖片（D7）。 */
  async duplicatesOf(
    item: GalleryItemRow,
    limit: number,
  ): Promise<Array<{ id: string; title: string }>> {
    if (!item.contentHash) return [];
    return this.db
      .select({ id: galleryItems.id, title: galleryItems.title })
      .from(galleryItems)
      .where(
        and(
          eq(galleryItems.contentHash, item.contentHash),
          ne(galleryItems.id, item.id),
          this.visible(),
        ),
      )
      .orderBy(asc(galleryItems.createdAt))
      .limit(limit);
  }

  /** 這張圖所在的相簿（沒刪除的）。 */
  async albumsOf(itemId: string): Promise<Array<{ id: string; name: string }>> {
    return this.db
      .select({ id: galleryAlbums.id, name: galleryAlbums.name })
      .from(galleryAlbumItems)
      .innerJoin(galleryAlbums, eq(galleryAlbums.id, galleryAlbumItems.albumId))
      .where(and(eq(galleryAlbumItems.itemId, itemId), notDeleted(galleryAlbums)))
      .orderBy(asc(galleryAlbums.name));
  }

  async uploaderOf(userId: string | null): Promise<{ id: string; name: string } | null> {
    if (!userId) return null;
    const [row] = await this.db
      .select({ id: users.id, name: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    return row ? { id: row.id, name: row.name } : null;
  }

  /** 稽核用：建立者的 email（背景工作沒有請求的脈絡）。 */
  async actorOf(userId: string | null): Promise<{ id: string; email: string } | null> {
    if (!userId) return null;
    const [row] = await this.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId));
    return row ?? null;
  }

  // ── 清理（gallery.maintenance） ──

  /** 登記早於 `cutoff`、一直沒完成上傳的。 */
  findAbandoned(cutoff: Date, limit: number): Promise<GalleryItemRow[]> {
    return this.db
      .select()
      .from(galleryItems)
      .where(and(eq(galleryItems.status, 'pending'), lt(galleryItems.createdAt, cutoff)))
      .orderBy(asc(galleryItems.createdAt))
      .limit(limit);
  }

  /** 處理失敗、最後更新早於 `cutoff` 的。 */
  findExpiredFailures(cutoff: Date, limit: number): Promise<GalleryItemRow[]> {
    return this.db
      .select()
      .from(galleryItems)
      .where(and(eq(galleryItems.status, 'failed'), lt(galleryItems.updatedAt, cutoff)))
      .orderBy(asc(galleryItems.updatedAt))
      .limit(limit);
  }

  /** 處理卡住的：排入過、要求的版本還沒寫好，而且最後一次排入早於 `cutoff`。 */
  findStuck(cutoff: Date, limit: number): Promise<GalleryItemRow[]> {
    return this.db
      .select()
      .from(galleryItems)
      .where(
        and(
          inArray(galleryItems.status, ['processing', 'ready']),
          or(
            sql`${galleryItems.variantRev} IS NULL`,
            ne(galleryItems.variantRev, galleryItems.rev),
          ),
          lt(galleryItems.queuedAt, cutoff),
        ),
      )
      .limit(limit);
  }

  findStaleRevs(now: Date, limit: number): Promise<GalleryItemRow[]> {
    return this.db
      .select()
      .from(galleryItems)
      .where(
        and(isNotNull(galleryItems.staleRevsPurgeAfter), lt(galleryItems.staleRevsPurgeAfter, now)),
      )
      .limit(limit);
  }

  async clearStaleRevs(id: string, purgeAfter: Date): Promise<void> {
    await this.db
      .update(galleryItems)
      .set({ staleRevsPurgeAfter: null })
      .where(and(eq(galleryItems.id, id), eq(galleryItems.staleRevsPurgeAfter, purgeAfter)));
  }

  /**
   * 刪除還沒出現在圖片庫的紀錄並釋出容量（放棄的上傳、過期的失敗、自己清掉的失敗；在呼叫端的交易內）。
   * 清理期間狀態變了（剛好完成上傳）就不刪。回傳實際刪到的 id。
   */
  async deleteUnready(ids: readonly string[], tx: DbOrTx): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .delete(galleryItems)
      .where(
        and(
          inArray(galleryItems.id, [...ids]),
          inArray(galleryItems.status, ['pending', 'failed']),
        ),
      )
      .returning({ id: galleryItems.id, size: galleryItems.size });
    await addStorageUsage(tx, -rows.reduce((total, row) => total + row.size, 0));
    return rows.map((row) => row.id);
  }

  async existingIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: galleryItems.id })
      .from(galleryItems)
      .where(inArray(galleryItems.id, [...ids]));
    return new Set(rows.map((row) => row.id));
  }

  /** 所有圖片計入容量的合計（`file.maintenance` 的對帳，`StorageSizeSources`）。 */
  async sumSizes(tx: DbOrTx): Promise<number> {
    const [row] = await tx
      .select({ used: sql<string>`coalesce(sum(${galleryItems.size}), 0)::text` })
      .from(galleryItems);
    return Number(row?.used ?? 0);
  }

  /** 平台關閉 `gallery` 前的確認框：圖片庫裡的張數。 */
  async countVisible(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(galleryItems)
      .where(this.visible());
    return row?.count ?? 0;
  }

  // ── 內部 ──

  private visible(): SQL {
    return and(notDeleted(galleryItems), eq(galleryItems.status, 'ready')) as SQL;
  }

  private filterConditions(filter: GalleryItemFilter): SQL[] {
    const conditions: SQL[] = [this.visible()];
    if (filter.keyword) {
      conditions.push(
        sql`(${galleryItems.title} || ' ' || coalesce(${galleryItems.description}, '')) ILIKE ${containsPattern(filter.keyword)}`,
      );
    }
    if (filter.albumId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${galleryAlbumItems} WHERE ${galleryAlbumItems.albumId} = ${filter.albumId} AND ${galleryAlbumItems.itemId} = ${galleryItems.id})`,
      );
    }
    if (filter.tagIds?.length) {
      conditions.push(hasAnyTag(RESOURCE_TYPE.GALLERY_ITEM, galleryItems.id, filter.tagIds));
    }
    if (filter.takenFrom) {
      conditions.push(
        sql`${galleryItems.sortAt} >= ${filter.takenFrom.toISOString()}::timestamptz`,
      );
    }
    if (filter.takenTo) conditions.push(lt(galleryItems.sortAt, filter.takenTo));
    if (filter.orientation) conditions.push(ORIENTATION_CONDITION[filter.orientation]);
    if (filter.uploaderId) conditions.push(eq(galleryItems.createdBy, filter.uploaderId));
    if (filter.origin === 'upload') conditions.push(eq(galleryItems.source, 'upload'));
    if (filter.origin === 'added') conditions.push(ne(galleryItems.source, 'upload'));
    if (filter.usage) {
      conditions.push(inArray(galleryItems.contentType, [...filter.usage.contentTypes]));
      conditions.push(sql`${galleryItems.size} <= ${filter.usage.maxSize}`);
    }
    return conditions;
  }
}
