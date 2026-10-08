import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { defineJob, JobQueue } from '@/core/jobs';

import { TenantUsageService } from './tenant-usage.service';

/**
 * 租戶用量的彙總（docs/architecture/05-tenancy.md §14.2 D2）：結果寫在平台 DB，一次走遍所有租戶，`scope: 'platform'`。
 * 每小時一次，當天的快照被覆寫；`exclusive` 讓前一輪沒跑完時不會疊上第二輪。
 */
export const TENANT_USAGE_ROLLUP_JOB = defineJob<Record<string, never>>('tenant.usageRollup', {
  scope: 'platform',
  exclusive: true,
  retryLimit: 0,
  expireInSeconds: 30 * 60,
});

@Injectable()
export class TenantUsageRollupJob implements OnModuleInit {
  constructor(
    private readonly usage: TenantUsageService,
    private readonly jobs: JobQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(TENANT_USAGE_ROLLUP_JOB, (_data, { signal }) => this.usage.rollup(signal), {
      cron: this.config.get('TENANT_USAGE_ROLLUP_CRON', { infer: true }),
    });
  }
}
