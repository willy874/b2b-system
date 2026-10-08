import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, isNotNull, lt, sql } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import type { TenantUsageSnapshot } from '@/core/usage';
import { tenantUsageDaily } from '@/db/platform/schema';
import type { TenantUsageDailyRow } from '@/db/platform/schema';

/** 平台 DB `tenant_usage_daily` 的快照寫入與查詢（docs/architecture/05-tenancy.md §5.4）。計數的寫入在 `core/usage`。 */
@Injectable()
export class TenantUsageRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  /** 最近一次快照（任何一天）。越過配額門檻的判斷拿它和這一次比較。 */
  async latestSnapshot(tenantId: string): Promise<TenantUsageDailyRow | undefined> {
    const [row] = await this.db
      .select()
      .from(tenantUsageDaily)
      .where(and(eq(tenantUsageDaily.tenantId, tenantId), isNotNull(tenantUsageDaily.snapshotAt)))
      .orderBy(desc(tenantUsageDaily.date))
      .limit(1);
    return row;
  }

  /**
   * 覆寫當天的快照欄；計數欄不動（可能已經有程序加進來）。來源沒提供的量寫 `null`，
   * 不留下前一次快照的舊值。
   */
  async saveSnapshot(
    tenantId: string,
    date: string,
    snapshot: Partial<TenantUsageSnapshot>,
    at: Date,
  ): Promise<void> {
    const values = {
      usersActive: snapshot.usersActive ?? null,
      usersTotal: snapshot.usersTotal ?? null,
      serviceAccounts: snapshot.serviceAccounts ?? null,
      storageUsedBytes: snapshot.storageUsedBytes ?? null,
      storageQuotaBytes: snapshot.storageQuotaBytes ?? null,
      lastLoginAt: snapshot.lastLoginAt ?? null,
      snapshotAt: at,
    };
    await this.db
      .insert(tenantUsageDaily)
      .values({ tenantId, date, ...values })
      .onConflictDoUpdate({
        target: [tenantUsageDaily.tenantId, tenantUsageDaily.date],
        set: values,
      });
  }

  /** `from`（含）以後的每一天，舊到新；沒有列的日子不在結果裡。 */
  async daily(tenantId: string, from: string): Promise<TenantUsageDailyRow[]> {
    return this.db
      .select()
      .from(tenantUsageDaily)
      .where(and(eq(tenantUsageDaily.tenantId, tenantId), gte(tenantUsageDaily.date, from)))
      .orderBy(asc(tenantUsageDaily.date));
  }

  /** 最後一個有對外 API 請求的日子（最後活動，§14.2 D7）。 */
  async lastExternalDate(tenantId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ date: sql<string | null>`max(${tenantUsageDaily.date})` })
      .from(tenantUsageDaily)
      .where(
        and(eq(tenantUsageDaily.tenantId, tenantId), gt(tenantUsageDaily.requestsExternal, 0)),
      );
    return row?.date ?? null;
  }

  /** 刪除 `before` 之前（不含）的日資料，回傳刪了幾列。一天只有「租戶數」那麼多列，不必分批。 */
  async purgeBefore(before: string): Promise<number> {
    const removed = await this.db
      .delete(tenantUsageDaily)
      .where(lt(tenantUsageDaily.date, before))
      .returning({ tenantId: tenantUsageDaily.tenantId });
    return removed.length;
  }
}
