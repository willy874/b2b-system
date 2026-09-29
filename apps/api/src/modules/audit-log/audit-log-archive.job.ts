import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { TENANT_DB } from '@/core/database';
import type { Database } from '@/core/database';
import { defineJob, JobQueue } from '@/core/jobs';

import { archiveAuditLogs } from './audit-log.archive';

/**
 * 稽核日誌熱 → 冷搬移（docs/architecture/backend/06-audit-log.md §8）。
 * 同時段只跑一個：上一輪沒結束時不再排入第二個（`exclusive`）。
 */
export const AUDIT_LOG_ARCHIVE_JOB = defineJob<Record<string, never>>('auditLog.archive', {
  exclusive: true,
  retryLimit: 3,
  retryDelaySeconds: 300,
  // 一次搬的量取決於保留期與寫入量，給足時間；中斷也安全（沒搬完的列還在熱表）
  expireInSeconds: 60 * 60,
});

/** 依 `AUDIT_LOG_ARCHIVE_CRON` 每天執行搬移；取代原本的外部 cron（docs/adr/0016-background-jobs.md D7）。 */
@Injectable()
export class AuditLogArchiveJob implements OnModuleInit {
  private readonly logger = new Logger(AuditLogArchiveJob.name);

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly jobs: JobQueue,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(AUDIT_LOG_ARCHIVE_JOB, () => this.run(), {
      cron: this.config.get('AUDIT_LOG_ARCHIVE_CRON', { infer: true }),
    });
  }

  async run(): Promise<{ moved: number; cutoff: string }> {
    const { moved, cutoff } = await archiveAuditLogs(this.db);
    this.logger.log({ moved, cutoff }, '稽核日誌搬移完成');
    return { moved, cutoff: cutoff.toISOString() };
  }
}
