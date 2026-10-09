import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import { addStorageUsage, readStorageUsage, reserveStorageUsage } from '@/core/usage';
import { imageAssets } from '@/db/schema';
import type { ImageAssetInsert, ImageAssetRow, ImageAssetVariants, ImageCrop } from '@/db/schema';

/** 處理出主檔之後寫回的描述。 */
export interface ImageMasterValues {
  width: number;
  height: number;
  hasAlpha: boolean;
  masterFormat: string;
  contentType: string;
  /** 主檔的大小；與登記的大小的差額在同一個交易內補進租戶的已用量。 */
  size: number;
  contentHash: string | null;
}

/** 認領：把資產交給一個資源使用（`WHERE` 的條件就是「能不能用」）。 */
export interface ImageClaim {
  ownerType: string;
  ownerId: string;
  actorId: string;
  usage: string;
}

/**
 * 圖片資產的查詢（docs/architecture/backend/25-image.md §15）。已用量（`file_storage_usage`）是租戶的計數：
 * 登記（`create`）、主檔寫好（`setMaster` 補差額）、刪除（`deleteRows`）在同一個交易內增減。
 */
@Injectable()
export class ImageAssetRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 租戶的已用量（讀計數那一列，O(1)）。 */
  storageUsed(tx?: DbOrTx): Promise<number> {
    return readStorageUsage(tx ?? this.db);
  }

  /** 在容量內登記一筆（在呼叫端的交易內）；超過容量回 undefined，什麼都不寫。 */
  async create(
    values: ImageAssetInsert,
    quota: number,
    tx: DbOrTx,
  ): Promise<ImageAssetRow | undefined> {
    if (!(await reserveStorageUsage(tx, values.size, quota))) return undefined;
    const [row] = await tx.insert(imageAssets).values(values).returning();
    if (!row) throw new Error('建立圖片資產失敗');
    return row;
  }

  async findById(id: string, tx?: DbOrTx): Promise<ImageAssetRow | undefined> {
    const [row] = await (tx ?? this.db).select().from(imageAssets).where(eq(imageAssets.id, id));
    return row;
  }

  async findByIds(ids: readonly string[]): Promise<ImageAssetRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(imageAssets)
      .where(inArray(imageAssets.id, [...ids]));
  }

  /** 這個人處理中的資產數（每人上限）。 */
  async countPending(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(imageAssets)
      .where(and(eq(imageAssets.createdBy, userId), eq(imageAssets.status, 'pending')));
    return row?.count ?? 0;
  }

  /** 標記「已排入處理」（清理排程依它判斷卡住的處理）。 */
  async markQueued(id: string, tx?: DbOrTx): Promise<void> {
    await (tx ?? this.db)
      .update(imageAssets)
      .set({ queuedAt: new Date() })
      .where(eq(imageAssets.id, id));
  }

  /** 完成上傳時帶的裁切（還沒有任何版本）。 */
  async setCrop(id: string, crop: ImageCrop, tx: DbOrTx): Promise<void> {
    await tx.update(imageAssets).set({ crop }).where(eq(imageAssets.id, id));
  }

  /** 主檔寫好：只有還沒有主檔的那一次會寫入（重複的工作拿到 false）。 */
  async setMaster(id: string, values: ImageMasterValues, tx: DbOrTx): Promise<boolean> {
    const [before] = await tx
      .select({ size: imageAssets.size })
      .from(imageAssets)
      .where(and(eq(imageAssets.id, id), isNull(imageAssets.masterFormat)))
      .for('update');
    if (!before) return false;
    await tx
      .update(imageAssets)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(imageAssets.id, id));
    await addStorageUsage(tx, values.size - before.size);
    return true;
  }

  /**
   * 一個版本的變體寫好：要求的版本仍是 `rev` 才寫入（處理途中又重新裁切了，就留給下一個工作）。
   * 原本已經有版本時，舊版本的物件在 `staleRevsPurgeAfter` 之後清掉（網址的效期過了才不會破圖）。
   */
  async setVariants(
    id: string,
    rev: number,
    variants: ImageAssetVariants,
    staleRevsPurgeAfter: Date,
  ): Promise<ImageAssetRow | undefined> {
    const [row] = await this.db
      .update(imageAssets)
      .set({
        status: 'ready',
        variantRev: rev,
        variants,
        staleRevsPurgeAfter: sql`CASE WHEN ${imageAssets.variantRev} IS NULL THEN ${imageAssets.staleRevsPurgeAfter} ELSE ${staleRevsPurgeAfter.toISOString()}::timestamptz END`,
        updatedAt: new Date(),
      })
      .where(and(eq(imageAssets.id, id), eq(imageAssets.rev, rev)))
      .returning();
    return row;
  }

  /** 處理途中被重新裁切：剛寫好的版本沒人用，交給清理排程刪掉。 */
  async scheduleStaleRevsPurge(id: string, at: Date): Promise<void> {
    await this.db
      .update(imageAssets)
      .set({ staleRevsPurgeAfter: at })
      .where(and(eq(imageAssets.id, id), isNull(imageAssets.staleRevsPurgeAfter)));
  }

  /** 只有還沒處理好的會被標成失敗（已有版本的資產重新裁切失敗時保留原本的版本）。 */
  async markFailed(id: string, reason: string): Promise<ImageAssetRow | undefined> {
    const [row] = await this.db
      .update(imageAssets)
      .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
      .where(and(eq(imageAssets.id, id), eq(imageAssets.status, 'pending')))
      .returning();
    return row;
  }

  /**
   * 「最近使用」（§15.7）：自己建立、可以用、沒有移除的；同一個內容雜湊只取最新的一筆，依建立時間新到舊。
   */
  async recent(userId: string, limit: number): Promise<ImageAssetRow[]> {
    const latest = this.db
      .selectDistinctOn([sql`coalesce(${imageAssets.contentHash}, ${imageAssets.id}::text)`], {
        id: imageAssets.id,
      })
      .from(imageAssets)
      .where(
        and(
          eq(imageAssets.createdBy, userId),
          eq(imageAssets.status, 'ready'),
          isNull(imageAssets.hiddenFromRecentAt),
        ),
      )
      .orderBy(
        sql`coalesce(${imageAssets.contentHash}, ${imageAssets.id}::text)`,
        desc(imageAssets.createdAt),
      )
      .as('latest');
    return this.db
      .select()
      .from(imageAssets)
      .where(inArray(imageAssets.id, this.db.select({ id: latest.id }).from(latest)))
      .orderBy(desc(imageAssets.createdAt), desc(imageAssets.id))
      .limit(limit);
  }

  /** 從「最近使用」移除；同一個內容的其他副本一併移除（否則下一筆會遞補上來）。 */
  async hideFromRecent(id: string, userId: string): Promise<boolean> {
    const [target] = await this.db
      .select({ contentHash: imageAssets.contentHash })
      .from(imageAssets)
      .where(and(eq(imageAssets.id, id), eq(imageAssets.createdBy, userId)));
    if (!target) return false;
    await this.db
      .update(imageAssets)
      .set({ hiddenFromRecentAt: new Date() })
      .where(
        and(
          eq(imageAssets.createdBy, userId),
          isNull(imageAssets.hiddenFromRecentAt),
          target.contentHash
            ? or(eq(imageAssets.id, id), eq(imageAssets.contentHash, target.contentHash))
            : eq(imageAssets.id, id),
        ),
      );
    return true;
  }

  /**
   * 認領（在 consumer 的交易內）：自己建立、還沒被使用、用途相同、沒有失敗的才認領得到。
   * 帶 `crop` 時一併改裁切並遞增要求的版本。
   */
  async claim(
    id: string,
    claim: ImageClaim,
    crop: ImageCrop | undefined,
    tx: DbOrTx,
  ): Promise<ImageAssetRow | undefined> {
    const [row] = await tx
      .update(imageAssets)
      .set({
        ownerType: claim.ownerType,
        ownerId: claim.ownerId,
        detachedAt: null,
        updatedAt: new Date(),
        ...(crop ? { crop, rev: sql`${imageAssets.rev} + 1` } : {}),
      })
      .where(
        and(
          eq(imageAssets.id, id),
          isNull(imageAssets.ownerId),
          eq(imageAssets.createdBy, claim.actorId),
          eq(imageAssets.usage, claim.usage),
          ne(imageAssets.status, 'failed'),
        ),
      )
      .returning();
    return row;
  }

  /** 解除（被換掉、擁有者被永久刪除）：保留擁有者欄位給排查，清理排程依 `detached_at` 判斷。 */
  async detach(ownerType: string, ownerId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(imageAssets)
      .set({ detachedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(imageAssets.ownerType, ownerType),
          eq(imageAssets.ownerId, ownerId),
          isNull(imageAssets.detachedAt),
        ),
      );
  }

  /** 解除一個資源的某一張（換頭像時解除舊的那張）。 */
  async detachOne(id: string, ownerType: string, ownerId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(imageAssets)
      .set({ detachedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(imageAssets.id, id),
          eq(imageAssets.ownerType, ownerType),
          eq(imageAssets.ownerId, ownerId),
          isNull(imageAssets.detachedAt),
        ),
      );
  }

  /** 重新裁切：改裁切並遞增要求的版本（擁有者的寫入交易內）。 */
  async recrop(
    id: string,
    owner: { ownerType: string; ownerId: string },
    crop: ImageCrop,
    tx: DbOrTx,
  ): Promise<ImageAssetRow | undefined> {
    const [row] = await tx
      .update(imageAssets)
      .set({ crop, rev: sql`${imageAssets.rev} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(imageAssets.id, id),
          eq(imageAssets.ownerType, owner.ownerType),
          eq(imageAssets.ownerId, owner.ownerId),
          isNull(imageAssets.detachedAt),
        ),
      )
      .returning();
    return row;
  }

  // ── 清理（image.maintenance，§15.6） ──

  /** 建立早於 `cutoff`、沒被認領的資產。 */
  findUnclaimed(cutoff: Date, limit: number): Promise<ImageAssetRow[]> {
    return this.db
      .select()
      .from(imageAssets)
      .where(and(isNull(imageAssets.ownerId), lt(imageAssets.createdAt, cutoff)))
      .orderBy(imageAssets.createdAt)
      .limit(limit);
  }

  /** 解除早於 `cutoff` 的資產。 */
  findDetached(cutoff: Date, limit: number): Promise<ImageAssetRow[]> {
    return this.db
      .select()
      .from(imageAssets)
      .where(and(isNotNull(imageAssets.detachedAt), lt(imageAssets.detachedAt, cutoff)))
      .orderBy(imageAssets.detachedAt)
      .limit(limit);
  }

  /** 舊版本的變體已經可以刪除的資產。 */
  findStaleRevs(now: Date, limit: number): Promise<ImageAssetRow[]> {
    return this.db
      .select()
      .from(imageAssets)
      .where(
        and(isNotNull(imageAssets.staleRevsPurgeAfter), lt(imageAssets.staleRevsPurgeAfter, now)),
      )
      .limit(limit);
  }

  async clearStaleRevs(id: string, purgeAfter: Date): Promise<void> {
    await this.db
      .update(imageAssets)
      .set({ staleRevsPurgeAfter: null })
      .where(and(eq(imageAssets.id, id), eq(imageAssets.staleRevsPurgeAfter, purgeAfter)));
  }

  /** 處理卡住的資產：排入過、要求的版本還沒寫好，而且最後一次排入早於 `cutoff`。 */
  findStuck(cutoff: Date, limit: number): Promise<ImageAssetRow[]> {
    return this.db
      .select()
      .from(imageAssets)
      .where(
        and(
          ne(imageAssets.status, 'failed'),
          or(isNull(imageAssets.variantRev), ne(imageAssets.variantRev, imageAssets.rev)),
          lt(imageAssets.queuedAt, cutoff),
        ),
      )
      .limit(limit);
  }

  /** 刪除紀錄並釋出容量（在呼叫端的交易內）；回傳實際刪到的 id。 */
  async deleteRows(ids: readonly string[], tx: DbOrTx): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await tx
      .delete(imageAssets)
      .where(
        and(
          inArray(imageAssets.id, [...ids]),
          // 清理期間被認領了（上傳之後剛好按了儲存）就不刪
          or(isNull(imageAssets.ownerId), isNotNull(imageAssets.detachedAt)),
        ),
      )
      .returning({ id: imageAssets.id, size: imageAssets.size });
    const freed = rows.reduce((total, row) => total + row.size, 0);
    await addStorageUsage(tx, -freed);
    return rows.map((row) => row.id);
  }

  /** 這些 id 裡還有紀錄的（殘留物件的對帳）。 */
  async existingIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: imageAssets.id })
      .from(imageAssets)
      .where(inArray(imageAssets.id, [...ids]));
    return new Set(rows.map((row) => row.id));
  }

  /** 所有資產計入容量的合計（`file.maintenance` 的對帳，`StorageSizeSources`）。 */
  async sumSizes(tx: DbOrTx): Promise<number> {
    const [row] = await tx
      .select({ used: sql<string>`coalesce(sum(${imageAssets.size}), 0)::text` })
      .from(imageAssets);
    return Number(row?.used ?? 0);
  }
}
