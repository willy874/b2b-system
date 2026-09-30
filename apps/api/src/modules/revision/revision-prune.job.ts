import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { defineJob, JobQueue } from '@/core/jobs';

import { RevisionService } from './revision.service';
import type { RevisionPruneReport } from './revision.service';

/**
 * 版本歷史的保留清理（ADR-0025 D1）。每個租戶各跑一次（`scope: 'tenant'`）；同一個租戶同時只跑一個（`exclusive`）。
 * 中途失敗也安全：已提交的批次已經刪掉，重做時只剩還沒處理的列。
 */
export const REVISION_PRUNE_JOB = defineJob<Record<string, never>>('revision.prune', {
  scope: 'tenant',
  exclusive: true,
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 30 * 60,
});

/** 依 `REVISION_PRUNE_CRON`（預設每天 04:45 UTC）執行。 */
@Injectable()
export class RevisionPruneJob implements OnModuleInit {
  constructor(
    private readonly revisions: RevisionService,
    private readonly jobs: JobQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(REVISION_PRUNE_JOB, () => this.run(), {
      cron: this.config.get('REVISION_PRUNE_CRON', { infer: true }),
    });
  }

  run(): Promise<RevisionPruneReport> {
    return this.revisions.prune();
  }
}
