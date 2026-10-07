import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { TENANT_DB } from '@/core/database';
import type { Database } from '@/core/database';
import { defineJob, JobQueue } from '@/core/jobs';
import {
  AUDIT_LOG_HOT_RETENTION_DAYS_PARAM,
  AUDIT_LOG_RETENTION_DAYS_PARAM,
  tenantFeatureParam,
} from '@/core/tenant';

import { archiveAuditLogs, maintainAuditArchive } from './audit-log.archive';

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

/** 依 `AUDIT_LOG_ARCHIVE_CRON` 每天執行搬移；取代原本的外部 cron（docs/architecture/backend/10-jobs.md §9.2 D7）。 */
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

  async run(): Promise<{
    moved: number;
    cutoff: string;
    retentionDays: number;
    purgedPartitions: number;
  }> {
    const retentionDays = tenantFeatureParam(AUDIT_LOG_HOT_RETENTION_DAYS_PARAM);
    const { moved, cutoff } = await archiveAuditLogs(this.db, retentionDays);
    // 冷表：預建分區、依保留期限刪除過期的月份（docs/architecture/backend/06-audit-log.md §10）
    const purged = await maintainAuditArchive(this.db, {
      retentionDays: tenantFeatureParam(AUDIT_LOG_RETENTION_DAYS_PARAM),
      hotRetentionDays: retentionDays,
      foreverValue: AUDIT_LOG_RETENTION_DAYS_PARAM.foreverValue,
    });
    this.logger.log({ moved, cutoff, retentionDays, purged }, '稽核日誌搬移完成');
    return {
      moved,
      cutoff: cutoff.toISOString(),
      retentionDays,
      purgedPartitions: purged.length,
    };
  }
}
