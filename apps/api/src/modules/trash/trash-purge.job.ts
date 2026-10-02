import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { defineJob, JobQueue } from '@/core/jobs';

import { TrashService } from './trash.service';
import type { TrashPurgeReport } from './trash.service';

/**
 * 回收桶到期永久刪除（docs/architecture/backend/14-revisions.md §9.2 D11）。每個租戶各跑一次（`scope: 'tenant'`，排程觸發時展開成每個 active 租戶一筆）；
 * 同一個租戶同時只跑一個（`exclusive`）。中途失敗也安全：已提交的批次已經刪掉，重做時只剩還沒處理的列。
 */
export const TRASH_PURGE_JOB = defineJob<Record<string, never>>('trash.purge', {
  scope: 'tenant',
  exclusive: true,
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 30 * 60,
});

/** 依 `TRASH_PURGE_CRON`（預設每天 04:30 UTC）執行。 */
@Injectable()
export class TrashPurgeJob implements OnModuleInit {
  constructor(
    private readonly trash: TrashService,
    private readonly jobs: JobQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(TRASH_PURGE_JOB, () => this.run(), {
      cron: this.config.get('TRASH_PURGE_CRON', { infer: true }),
    });
  }

  run(): Promise<TrashPurgeReport> {
    return this.trash.purgeExpired();
  }
}
