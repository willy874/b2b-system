import { Injectable, Logger } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';

import { tenantUsageFlushFailures } from '../metrics';
import { currentTenant } from '../tenant';
import { UsageCounterRepository } from './usage-counter.repository';
import type { UsageCountRow, UsageCounts } from './usage-counter.repository';
import { usageDate } from './usage-date';

/** 多久把記憶體裡的計數寫進平台 DB 一次。 */
const FLUSH_INTERVAL_MS = 60_000;

export type UsageCounter = keyof UsageCounts;

/**
 * 依租戶累計的計數（docs/architecture/05-tenancy.md §14.2 D3）：請求數、背景工作數。
 *
 * 每次都寫 DB 會讓每個唯讀的請求多一次寫入，所以先記在記憶體，每分鐘一條 INSERT 加到當天的列；
 * 程序結束前再寫一次，當掉時最多少記一分鐘（同 `api_tokens.last_used_at`）。
 * 不經過 Prometheus：指標不帶租戶標籤（docs/architecture/08-monitoring.md §2.3）。
 */
@Injectable()
export class UsageMeter implements OnApplicationShutdown {
  private readonly logger = new Logger(UsageMeter.name);
  /** `日期 → 租戶 id → 計數`：跨過午夜的那一輪也記在發生的那一天。 */
  private pending = new Map<string, Map<string, UsageCounts>>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly repo: UsageCounterRepository) {}

  /** 在目前租戶的脈絡裡加一次；沒有租戶（平台的請求、平台工作）不記。 */
  count(counter: UsageCounter): void {
    const tenantId = currentTenant()?.id;
    if (!tenantId) return;
    const date = usageDate();
    let tenantsOfDay = this.pending.get(date);
    if (!tenantsOfDay) {
      tenantsOfDay = new Map();
      this.pending.set(date, tenantsOfDay);
    }
    let counts = tenantsOfDay.get(tenantId);
    if (!counts) {
      counts = { requestsInternal: 0, requestsExternal: 0, jobsExecuted: 0 };
      tenantsOfDay.set(tenantId, counts);
    }
    counts[counter] += 1;
    if (!this.timer) {
      this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
      this.timer.unref();
    }
  }

  /** 把累計的計數寫出去。失敗時這一輪的計數丟掉：留著重試，平台 DB 長時間連不上時記憶體會一直長。 */
  async flush(): Promise<void> {
    const batch = this.pending;
    this.pending = new Map();
    const rows: UsageCountRow[] = [];
    for (const [date, tenantsOfDay] of batch) {
      for (const [tenantId, counts] of tenantsOfDay) rows.push({ tenantId, date, ...counts });
    }
    try {
      await this.repo.add(rows);
    } catch (error) {
      tenantUsageFlushFailures.inc();
      this.logger.warn({ err: error, rows: rows.length }, '租戶用量的計數寫入失敗');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }
}
