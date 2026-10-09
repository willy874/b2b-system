import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { defineJob, JobQueue } from '@/core/jobs';

import { StorageTotalService } from './storage-total.service';

/**
 * 所有租戶已用量的彙總（docs/architecture/backend/25-image.md §12 D8）：結果寫在平台 DB，一次走遍所有租戶，`scope: 'platform'`。
 * 預設每 5 分鐘；`exclusive` 讓前一輪沒跑完時不會疊上第二輪。
 */
export const STORAGE_TOTAL_ROLLUP_JOB = defineJob<Record<string, never>>('storage.totalRollup', {
  scope: 'platform',
  exclusive: true,
  retryLimit: 0,
  expireInSeconds: 10 * 60,
});

@Injectable()
export class StorageTotalRollupJob implements OnModuleInit {
  constructor(
    private readonly storage: StorageTotalService,
    private readonly jobs: JobQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(
      STORAGE_TOTAL_ROLLUP_JOB,
      (_data, { signal }) => this.storage.rollup(signal),
      { cron: this.config.get('STORAGE_TOTAL_ROLLUP_CRON', { infer: true }) },
    );
  }
}
