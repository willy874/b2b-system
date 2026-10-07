import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { deleteInBatches } from '@/core/database';
import { defineJob, JobQueue } from '@/core/jobs';

import {
  MFA_CHALLENGE_RETENTION_MS,
  MFA_CLEANUP_BATCH_SIZE,
  MFA_PENDING_FACTOR_TTL_MS,
} from './mfa.constants';
import type { MfaRepository } from './mfa.repository';
import { PlatformMfaRepository } from './platform-mfa.repository';
import { TenantMfaRepository } from './tenant-mfa.repository';

const CLEANUP_OPTIONS = { exclusive: true, retryLimit: 2, retryDelaySeconds: 300 } as const;

/** 每個租戶：沒確認的因子（24 小時）與過期的 challenge（docs/architecture/backend/21-mfa.md §3）。 */
export const MFA_CLEANUP_JOB = defineJob<Record<string, never>>('mfa.cleanup', CLEANUP_OPTIONS);
/** 平台管理者的同一份清理。 */
export const MFA_PLATFORM_CLEANUP_JOB = defineJob<Record<string, never>>('mfa.platformCleanup', {
  ...CLEANUP_OPTIONS,
  scope: 'platform',
});

/** 與 token 的清理同一個排程（`AUTH_TOKEN_CLEANUP_CRON`）。 */
@Injectable()
export class MfaCleanupJobs implements OnModuleInit {
  private readonly logger = new Logger(MfaCleanupJobs.name);

  constructor(
    private readonly jobs: JobQueue,
    private readonly tenantRepo: TenantMfaRepository,
    private readonly platformRepo: PlatformMfaRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    const cron = this.config.get('AUTH_TOKEN_CLEANUP_CRON', { infer: true });
    this.jobs.register(MFA_CLEANUP_JOB, () => this.run(this.tenantRepo), { cron });
    this.jobs.register(MFA_PLATFORM_CLEANUP_JOB, () => this.run(this.platformRepo), { cron });
  }

  async run(repo: MfaRepository<unknown>): Promise<{ deleted: number }> {
    const now = Date.now();
    const deleted = await deleteInBatches(
      (size) =>
        repo.deleteStaleBatch(
          new Date(now - MFA_PENDING_FACTOR_TTL_MS),
          new Date(now - MFA_CHALLENGE_RETENTION_MS),
          size,
        ),
      MFA_CLEANUP_BATCH_SIZE,
    );
    this.logger.log({ deleted }, '已清除過期的 MFA 設定與 challenge');
    return { deleted };
  }
}
