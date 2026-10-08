import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { tenantUsageDaily } from '@/db/platform/schema';

import { PLATFORM_DB } from '../database';
import type { PlatformDatabase } from '../database';

/** 一個租戶一天累計的計數（docs/architecture/05-tenancy.md §14.2 D3）。 */
export interface UsageCounts {
  requestsInternal: number;
  requestsExternal: number;
  jobsExecuted: number;
}

export interface UsageCountRow extends UsageCounts {
  tenantId: string;
  date: string;
}

/** 計數寫進平台 DB 的 `tenant_usage_daily`；快照與讀取在 `modules/tenant`。 */
@Injectable()
export class UsageCounterRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  /** 一條 INSERT 把這一輪的計數 **加** 到各列（沒有那一天的列就建立）：多個程序同時寫入也不會互相蓋掉。 */
  async add(rows: readonly UsageCountRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insert(tenantUsageDaily)
      .values([...rows])
      .onConflictDoUpdate({
        target: [tenantUsageDaily.tenantId, tenantUsageDaily.date],
        set: {
          requestsInternal: sql`${tenantUsageDaily.requestsInternal} + excluded.requests_internal`,
          requestsExternal: sql`${tenantUsageDaily.requestsExternal} + excluded.requests_external`,
          jobsExecuted: sql`${tenantUsageDaily.jobsExecuted} + excluded.jobs_executed`,
        },
      });
  }
}
