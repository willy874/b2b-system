import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { defineJob, JobQueue } from '@/core/jobs';

import { OidcPayloadRepository } from './oidc-payload.repository';

/** 清掉過期的 IdP 狀態（session、互動、授權碼…）。同時段只跑一個。 */
export const OIDC_CLEANUP_JOB = defineJob<Record<string, never>>('oidc.cleanup', {
  // oidc_payloads 在平台 DB（docs/architecture/05-tenancy.md §10.2 D1）
  scope: 'platform',
  exclusive: true,
  retryLimit: 2,
  retryDelaySeconds: 60,
});

/**
 * `oidc_payloads` 的過期列：provider 讀取時已視為不存在（`DrizzleOidcAdapter`），
 * 這裡只是回收空間。依 `OIDC_CLEANUP_CRON` 由背景工作執行（docs/architecture/backend/10-jobs.md）。
 */
@Injectable()
export class OidcCleanupJobs implements OnModuleInit {
  private readonly logger = new Logger(OidcCleanupJobs.name);

  constructor(
    private readonly jobs: JobQueue,
    private readonly repo: OidcPayloadRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(OIDC_CLEANUP_JOB, () => this.run(), {
      cron: this.config.get('OIDC_CLEANUP_CRON', { infer: true }),
    });
  }

  async run(): Promise<{ deleted: number }> {
    const deleted = await this.repo.deleteExpired();
    this.logger.log({ deleted }, '已清除過期的 OIDC 狀態');
    return { deleted };
  }
}
