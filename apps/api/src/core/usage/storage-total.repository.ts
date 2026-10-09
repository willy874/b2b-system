import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { tenantStorageUsage } from '@/db/platform/schema';

import { PLATFORM_DB } from '../database';
import type { PlatformDatabase } from '../database';

/** 所有租戶已用量的合計；還沒有任何量測時 `measuredAt` 是 `null`。 */
export interface StorageTotal {
  usedBytes: number;
  /** 最近一次量測的時間（任一個租戶）。 */
  measuredAt: Date | null;
}

/** 平台 DB 的 `tenant_storage_usage`（docs/architecture/backend/25-image.md §12 D8）。 */
@Injectable()
export class StorageTotalRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async total(): Promise<StorageTotal> {
    const [row] = await this.db
      .select({
        usedBytes: sql<string>`coalesce(sum(${tenantStorageUsage.usedBytes}), 0)`,
        measuredAt: sql<Date | null>`max(${tenantStorageUsage.measuredAt})`,
      })
      .from(tenantStorageUsage);
    const measuredAt = row?.measuredAt ?? null;
    return {
      usedBytes: Number(row?.usedBytes ?? 0),
      measuredAt: measuredAt === null ? null : new Date(measuredAt),
    };
  }

  async save(tenantId: string, usedBytes: number, measuredAt: Date): Promise<void> {
    await this.db
      .insert(tenantStorageUsage)
      .values({ tenantId, usedBytes, measuredAt })
      .onConflictDoUpdate({
        target: tenantStorageUsage.tenantId,
        set: { usedBytes, measuredAt },
      });
  }
}
