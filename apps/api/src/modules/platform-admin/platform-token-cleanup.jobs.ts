import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { defineJob, JobQueue } from '@/core/jobs';
import { deleteInBatches } from '@/modules/credential/delete-in-batches';

import { PlatformRefreshTokenRepository } from './platform-refresh-token.repository';

/**
 * 平台管理者的 `platform_refresh_tokens`（平台 DB）：規則與租戶的 `auth.tokenCleanup` 相同
 * （docs/architecture/backend/04-auth.md §8）。工作名稱已發布，不隨模組搬家改名。
 */
export const PLATFORM_TOKEN_CLEANUP_JOB = defineJob<Record<string, never>>(
  'auth.platformTokenCleanup',
  { exclusive: true, retryLimit: 2, retryDelaySeconds: 300, scope: 'platform' },
);

@Injectable()
export class PlatformTokenCleanupJobs implements OnModuleInit {
  private readonly logger = new Logger(PlatformTokenCleanupJobs.name);

  constructor(
    private readonly jobs: JobQueue,
    private readonly refreshTokens: PlatformRefreshTokenRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(PLATFORM_TOKEN_CLEANUP_JOB, () => this.run(), {
      cron: this.config.get('AUTH_TOKEN_CLEANUP_CRON', { infer: true }),
    });
  }

  async run(): Promise<{ refreshTokens: number }> {
    const days = this.config.get('AUTH_TOKEN_RETENTION_DAYS', { infer: true });
    const refreshTokens = await deleteInBatches((size) =>
      this.refreshTokens.deleteExpiredBatch(days, size),
    );
    this.logger.log({ refreshTokens }, '已清除過期的平台 refresh token');
    return { refreshTokens };
  }
}
