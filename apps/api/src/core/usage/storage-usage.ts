import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import { fileStorageUsage } from '@/db/schema';

import type { DbOrTx } from '../database';
import { AppException } from '../errors';
import { FILE_STORAGE_QUOTA_MB_PARAM, tenantFeatureParam } from '../tenant';

/**
 * 租戶的儲存容量（docs/architecture/05-tenancy.md §13.3 D8；docs/architecture/backend/25-image.md §16.2 D3）。
 *
 * 計數那一列（`file_storage_usage`）是 **租戶的** 已用量：檔案、圖片資產（之後的圖片庫）在各自登記、永久刪除的交易內增減，
 * 上限共用 `file.storageQuotaMb`（`file` 關掉時照常生效）。名稱沿用檔案的，上線後不改名（docs/architecture/backend/25-image.md §16.2 D3）。
 * 對帳由 `file.maintenance` 以「`files` 的合計 ＋ 其他擁有者登記的合計」（`StorageSizeSources`）重算。
 */

const MIB = 1024 * 1024;

/** 租戶的容量，位元組（`file.storageQuotaMb`）。要在租戶脈絡內呼叫。 */
export function tenantStorageQuotaBytes(): number {
  return tenantFeatureParam(FILE_STORAGE_QUOTA_MB_PARAM) * MIB;
}

/** 加上 `size` 會超過容量時的錯誤（`details` 給前端顯示剩餘的空間）。 */
export function storageQuotaExceeded(used: number, size: number): AppException {
  return new AppException('FILE_STORAGE_QUOTA_EXCEEDED', {
    quota: tenantStorageQuotaBytes(),
    used,
    size,
  });
}

/** 已用量，位元組：讀計數那一列，O(1)。 */
export async function readStorageUsage(db: DbOrTx): Promise<number> {
  const [row] = await db
    .select({ usedBytes: fileStorageUsage.usedBytes })
    .from(fileStorageUsage)
    .limit(1);
  return row?.usedBytes ?? 0;
}

/**
 * 在容量內佔用 `size`（在呼叫端的交易內）：一條條件式 UPDATE，加上之後不超過 `quota` 才更新。
 * 檢查與佔用是同一條語句，同時的登記以計數那一列的列鎖排隊。超過容量回 false，什麼都不寫。
 */
export async function reserveStorageUsage(
  tx: DbOrTx,
  size: number,
  quota: number,
): Promise<boolean> {
  const [reserved] = await tx
    .update(fileStorageUsage)
    .set({ usedBytes: sql`${fileStorageUsage.usedBytes} + ${size}` })
    .where(
      and(eq(fileStorageUsage.id, true), sql`${fileStorageUsage.usedBytes} + ${size} <= ${quota}`),
    )
    .returning({ usedBytes: fileStorageUsage.usedBytes });
  return reserved !== undefined;
}

/** 已用量加上 `delta`（可為負）。不低於 0：計數有偏差時等對帳修正，不讓刪除因此失敗。 */
export async function addStorageUsage(tx: DbOrTx, delta: number): Promise<void> {
  if (delta === 0) return;
  await tx
    .update(fileStorageUsage)
    .set({ usedBytes: sql`greatest(${fileStorageUsage.usedBytes} + ${delta}, 0)` })
    .where(eq(fileStorageUsage.id, true));
}

/** 在呼叫端的交易內回報這個擁有者計入容量的位元組合計（例：`SUM(image_assets.size)`）。 */
export type StorageSizeSource = (tx: DbOrTx) => Promise<number>;

/**
 * 檔案以外、也計入租戶容量的擁有者（圖片資產、之後的圖片庫）：在 `onModuleInit` 登記自己的合計，
 * `file.maintenance` 對帳時加總，計數才不會被重算成只有檔案的大小。core 不認識業務模組（docs/coding-standards/07-layer-dependencies.md §3.2）。
 */
@Injectable()
export class StorageSizeSources {
  private readonly sources = new Map<string, StorageSizeSource>();

  /** `owner` 是登記的模組名稱，只用來擋重複登記。 */
  register(owner: string, source: StorageSizeSource): void {
    if (this.sources.has(owner)) throw new Error(`${owner} 的容量合計重複登記`);
    this.sources.set(owner, source);
  }

  /** 所有登記者的合計（在對帳的交易內依序查詢）。 */
  async sum(tx: DbOrTx): Promise<number> {
    let total = 0;
    for (const source of this.sources.values()) {
      // oxlint-disable-next-line no-await-in-loop -- 同一個交易的連線上依序查詢
      total += await source(tx);
    }
    return total;
  }
}
