import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  like,
  isNotNull,
  lt,
  not,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import type { FileInsert, FileRow, FileVariantStatus } from '@/db/schema';
import { files, users } from '@/db/schema';

import type { ListFileDto } from './dto/list-file.dto';
import { FILE_CATEGORY_RULES } from './file.constants';
import type { FileCategory } from './file.constants';
import type { FileCursor } from './file.cursor';

export interface FileWithUploader extends FileRow {
  uploader: { id: string; displayName: string } | null;
}

const SORT_COLUMNS = {
  createdAt: files.createdAt,
  name: files.name,
  size: files.size,
} as const;

/** LIKE 的萬用字元當成一般字元比對。 */
function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class FileRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  private selectWithUploader() {
    return this.db
      .select({
        file: files,
        uploaderId: users.id,
        uploaderName: users.displayName,
      })
      .from(files)
      .leftJoin(users, eq(users.id, files.createdBy));
  }

  private static toFileWithUploader(row: {
    file: FileRow;
    uploaderId: string | null;
    uploaderName: string | null;
  }): FileWithUploader {
    return {
      ...row.file,
      uploader:
        row.uploaderId === null || row.uploaderName === null
          ? null
          : { id: row.uploaderId, displayName: row.uploaderName },
    };
  }

  /** 未刪除的檔案（含 pending）。 */
  async findById(id: string): Promise<FileWithUploader | undefined> {
    const [row] = await this.selectWithUploader()
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .limit(1);
    return row && FileRepository.toFileWithUploader(row);
  }

  /**
   * 只列出 `ready` 的檔案；`pending` 是還沒完成的上傳，不出現在列表。
   * 有 `after`（keyset 游標）時忽略 offset，只依 `sort[0]` ＋ id 排序，取「排在游標之後」的一頁。
   * `lastCreatedAt` 是最後一筆的 `created_at`（微秒精度），給下一頁的游標用。
   * `scope.folderIds`：只列這些資料夾裡的檔案（根目錄不含在內）；不帶則不限（資料夾層級授權的範圍）。
   */
  async list(
    query: ListFileDto,
    after?: FileCursor,
    scope?: { folderIds: readonly string[] },
  ): Promise<{
    items: FileWithUploader[];
    total: number | null;
    lastCreatedAt: string | undefined;
  }> {
    if (scope?.folderIds.length === 0) {
      return { items: [], total: after ? null : 0, lastCreatedAt: undefined };
    }
    const conditions: SQL[] = [isNull(files.deletedAt), eq(files.status, 'ready')];
    if (scope) conditions.push(inArray(files.folderId, [...scope.folderIds]));
    if (query.keyword) conditions.push(ilike(files.name, `%${escapeLike(query.keyword)}%`));
    if (query.contentType) {
      conditions.push(
        query.contentType.endsWith('/*')
          ? like(files.contentType, `${escapeLike(query.contentType.slice(0, -1))}%`)
          : eq(files.contentType, query.contentType),
      );
    }
    if (query.category) conditions.push(categoryCondition(query.category));
    if (query.folderId) {
      conditions.push(
        query.folderId === 'root' ? isNull(files.folderId) : eq(files.folderId, query.folderId),
      );
    }
    if (query.uploaderId) conditions.push(eq(files.createdBy, query.uploaderId));
    const where = and(...conditions);

    const sorts = after ? [after.sort] : query.sort;
    // 最後以 id 收尾，讓同值的列在分頁之間順序穩定
    const orderBy = sorts.map(({ sort, order }) =>
      order === 'asc' ? asc(SORT_COLUMNS[sort]) : desc(SORT_COLUMNS[sort]),
    );
    const pageWhere = after ? and(where, afterCursor(after)) : where;

    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          file: files,
          uploaderId: users.id,
          uploaderName: users.displayName,
          createdAtExact: sql<string>`to_char(${files.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(files)
        .leftJoin(users, eq(users.id, files.createdBy))
        .where(pageWhere)
        .orderBy(...orderBy, desc(files.id))
        .limit(query.limit)
        .offset(after ? 0 : query.offset),
      // 帶游標的頁（無限捲動往下捲）不重算總數：前端只用第一頁的 total
      after
        ? Promise.resolve([])
        : this.db
            .select({ total: sql<number>`count(*)::int` })
            .from(files)
            .where(where),
    ]);
    return {
      items: rows.map(FileRepository.toFileWithUploader),
      total: after ? null : (counted?.total ?? 0),
      lastCreatedAt: rows.at(-1)?.createdAtExact,
    };
  }

  async create(values: FileInsert, tx?: DbOrTx): Promise<FileRow> {
    const db = tx ?? this.db;
    const [row] = await db.insert(files).values(values).returning();
    if (!row) throw new Error('建立檔案紀錄失敗');
    return row;
  }

  /** 只有 `pending` 會被改成 `ready`；並行的第二次完成請求拿到 undefined。 */
  async markReady(
    id: string,
    values: {
      size: number;
      etag: string;
      uploadedAt: Date;
      hasThumbnail: boolean;
      variantStatus: FileVariantStatus;
      updatedBy: string;
    },
    tx?: DbOrTx,
  ): Promise<FileRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(files)
      .set({ ...values, status: 'ready', uploadId: null })
      .where(and(eq(files.id, id), eq(files.status, 'pending'), isNull(files.deletedAt)))
      .returning();
    return row;
  }

  /**
   * 改名並遞增版本。帶 `expectedVersion` 時只在版本相符才更新（比對與寫入在同一個 UPDATE，
   * 不會有「讀到舊版本後別人搶先寫入」的空窗）；不符回 undefined。
   */
  async update(
    id: string,
    values: Pick<FileInsert, 'name' | 'updatedBy'>,
    expectedVersion?: number,
    tx?: DbOrTx,
  ): Promise<FileRow | undefined> {
    const db = tx ?? this.db;
    const conditions = [eq(files.id, id), isNull(files.deletedAt)];
    if (expectedVersion !== undefined) conditions.push(eq(files.version, expectedVersion));
    const [row] = await db
      .update(files)
      .set({ ...values, version: sql`${files.version} + 1` })
      .where(and(...conditions))
      .returning();
    return row;
  }

  /** 未刪除的檔案目前的 `version`；不存在或已刪除回 undefined（改名的樂觀鎖衝突時重讀）。 */
  async findVersion(id: string, tx?: DbOrTx): Promise<number | undefined> {
    const [row] = await (tx ?? this.db)
      .select({ version: files.version })
      .from(files)
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .limit(1);
    return row?.version;
  }

  /**
   * 放棄上傳：只作用在 `pending`，已完成的上傳不受影響。
   * `actorId` 為 null 是維護排程清掉的逾時上傳。
   */
  async discardPending(
    id: string,
    actorId: string | null,
    tx?: DbOrTx,
  ): Promise<FileRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(files)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(files.id, id), eq(files.status, 'pending'), isNull(files.deletedAt)))
      .returning();
    return row;
  }

  /** 影像變體產生完成。只作用在還在等待的檔案：途中被刪除的回 undefined。 */
  async markVariantsReady(
    id: string,
    values: { imageWidth: number; imageHeight: number; variantFormat: string },
  ): Promise<FileRow | undefined> {
    const [row] = await this.db
      .update(files)
      .set({ ...values, variantStatus: 'ready' })
      .where(and(eq(files.id, id), eq(files.variantStatus, 'pending'), isNull(files.deletedAt)))
      .returning();
    return row;
  }

  async markVariantsFailed(id: string): Promise<void> {
    await this.db
      .update(files)
      .set({ variantStatus: 'failed' })
      .where(and(eq(files.id, id), eq(files.variantStatus, 'pending')));
  }

  /** 完成上傳超過一段時間仍在等待產生影像變體的檔案（最早完成的先）。 */
  async findPendingVariants(uploadedBefore: Date, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.variantStatus, 'pending'),
          isNull(files.deletedAt),
          lt(files.uploadedAt, uploadedBefore),
        ),
      )
      .orderBy(asc(files.uploadedAt))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  /** 登記早於 `createdBefore` 仍未完成的上傳，依 id 分頁（`afterId` 之後）。 */
  async findStalePending(
    createdBefore: Date,
    afterId: string | undefined,
    limit: number,
  ): Promise<Pick<FileRow, 'id' | 'storageKey' | 'uploadId'>[]> {
    const conditions = [
      eq(files.status, 'pending'),
      isNull(files.deletedAt),
      lt(files.createdAt, createdBefore),
    ];
    if (afterId) conditions.push(gt(files.id, afterId));
    return this.db
      .select({ id: files.id, storageKey: files.storageKey, uploadId: files.uploadId })
      .from(files)
      .where(and(...conditions))
      .orderBy(asc(files.id))
      .limit(limit);
  }

  /** 這些 id 之中還沒刪除的（含 pending）。 */
  async findLiveIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: files.id })
      .from(files)
      .where(and(inArray(files.id, [...ids]), isNull(files.deletedAt)));
    return new Set(rows.map((row) => row.id));
  }

  /** 這些分塊上傳之中還屬於某個未刪除紀錄的。 */
  async findLiveUploadIds(uploadIds: readonly string[]): Promise<Set<string>> {
    if (uploadIds.length === 0) return new Set();
    const rows = await this.db
      .select({ uploadId: files.uploadId })
      .from(files)
      .where(
        and(
          inArray(files.uploadId, [...uploadIds]),
          isNotNull(files.uploadId),
          isNull(files.deletedAt),
        ),
      );
    return new Set(rows.flatMap((row) => (row.uploadId ? [row.uploadId] : [])));
  }

  async softDelete(id: string, actorId: string, tx?: DbOrTx): Promise<FileRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(files)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .returning();
    return row;
  }
}

/** 分類 → content_type 條件；`other` 是「不屬於任何一類」。 */
function categoryCondition(category: FileCategory): SQL {
  if (category !== 'other') return ruleCondition(FILE_CATEGORY_RULES[category]);
  const any = or(...Object.values(FILE_CATEGORY_RULES).map(ruleCondition));
  return any ? not(any) : sql`true`;
}

function ruleCondition(rule: { prefixes: readonly string[]; types: readonly string[] }): SQL {
  const parts: SQL[] = rule.prefixes.map((prefix) =>
    like(files.contentType, `${escapeLike(prefix)}%`),
  );
  if (rule.types.length > 0) parts.push(inArray(files.contentType, [...rule.types]));
  return or(...parts) ?? sql`false`;
}

/**
 * keyset：「排在游標那一筆之後」。id 一律降冪收尾（與 `orderBy` 相同），
 * 所以條件是 `col <op> v OR (col = v AND id < cursorId)`，`<op>` 依主排序的方向。
 */
function afterCursor(cursor: FileCursor): SQL | undefined {
  const column = SORT_COLUMNS[cursor.sort.sort];
  const value = cursor.sort.sort === 'createdAt' ? sql`${cursor.value}::timestamptz` : cursor.value;
  const beyond = cursor.sort.order === 'asc' ? gt(column, value) : lt(column, value);
  return or(beyond, and(eq(column, value), lt(files.id, cursor.id)));
}
