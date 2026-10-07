import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';

import type { Env } from '@/core/config';
import type { PlatformDatabase } from '@/core/database';
import { PLATFORM_DB } from '@/core/database';
import { JobQueue } from '@/core/jobs';
import { EventLoopMonitor } from '@/core/metrics';
import { ObjectStorage } from '@/core/storage';

type CheckResult = 'ok' | 'fail';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  checks?: Record<string, CheckResult>;
}

/** 單一項檢查的上限：連線卡住時就緒檢查仍要在探針的逾時（3 秒）內回應。 */
const CHECK_TIMEOUT_MS = 2000;

function withTimeout(check: Promise<boolean>): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS);
  });
  return Promise.race([check.catch(() => false), timeout])
    .then((isUp): CheckResult => (isUp ? 'ok' : 'fail'))
    .finally(() => clearTimeout(timer));
}

/**
 * 存活與就緒（docs/architecture/08-monitoring.md §4）。租戶 DB 不在就緒檢查裡：單一租戶的 DB 掛掉不該讓整個程序
 * 被 LB 摘掉（`Tenancy.enter` 已經只對那個租戶回 503），改看指標 `api_tenant_unavailable_total`。
 */
@Injectable()
export class HealthService {
  private readonly eventLoopLagLimitMs: number;

  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDatabase,
    private readonly storage: ObjectStorage,
    private readonly jobs: JobQueue,
    private readonly eventLoop: EventLoopMonitor,
    config: ConfigService<Env, true>,
  ) {
    this.eventLoopLagLimitMs = config.get('HEALTH_EVENT_LOOP_LAG_MS', { infer: true });
  }

  live(): HealthStatus {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async ready(): Promise<HealthStatus> {
    const [database, storage, jobs] = await Promise.all([
      withTimeout(this.pingDatabase()),
      withTimeout(this.storage.ping()),
      withTimeout(this.jobs.ping()),
    ]);
    const checks: Record<string, CheckResult> = { database, storage, jobs };
    // event loop 卡住時請求都在排隊：先讓 LB 把流量導走，不等到探針逾時
    if (this.eventLoopLagLimitMs > 0) {
      checks.eventLoop = this.eventLoop.p99Ms() <= this.eventLoopLagLimitMs ? 'ok' : 'fail';
    }
    return {
      ...this.live(),
      status: Object.values(checks).every((result) => result === 'ok') ? 'ok' : 'degraded',
      checks,
    };
  }

  private async pingDatabase(): Promise<boolean> {
    await this.db.execute(sql`select 1`);
    return true;
  }
}
