import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { deleteInBatches } from '@/core/database';
import { defineJob, JobQueue } from '@/core/jobs';

import { AuthTokenService } from './auth-token.service';
import { TOKEN_CLEANUP_BATCH_SIZE } from './credential.constants';
import { RefreshTokenRepository } from './refresh-token.repository';

const CLEANUP_OPTIONS = { exclusive: true, retryLimit: 2, retryDelaySeconds: 300 } as const;

/** 每個租戶的 `refresh_tokens` 與 `auth_tokens`（docs/architecture/backend/04-auth.md §8）。 */
export const AUTH_TOKEN_CLEANUP_JOB = defineJob<Record<string, never>>(
  'auth.tokenCleanup',
  CLEANUP_OPTIONS,
);

/**
 * 清除過期的 token：每次續期都新增一列，不清的話表與索引一路膨脹，續期與登出的成本跟著變高。
 * 過期後保留 `AUTH_TOKEN_RETENTION_DAYS` 天，讓安全事件調查時還查得到「這個 token 什麼時候被用過」。
 */
@Injectable()
export class AuthTokenCleanupJobs implements OnModuleInit {
  private readonly logger = new Logger(AuthTokenCleanupJobs.name);

  constructor(
    private readonly jobs: JobQueue,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly authTokens: AuthTokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(AUTH_TOKEN_CLEANUP_JOB, () => this.run(), {
      cron: this.config.get('AUTH_TOKEN_CLEANUP_CRON', { infer: true }),
    });
  }

  async run(): Promise<{ refreshTokens: number; authTokens: number }> {
    const days = this.config.get('AUTH_TOKEN_RETENTION_DAYS', { infer: true });
    const refreshTokens = await deleteInBatches(
      (size) => this.refreshTokens.deleteExpiredBatch(days, size),
      TOKEN_CLEANUP_BATCH_SIZE,
    );
    const authTokens = await deleteInBatches(
      (size) => this.authTokens.deleteStaleBatch(days, size),
      TOKEN_CLEANUP_BATCH_SIZE,
    );
    this.logger.log({ refreshTokens, authTokens }, '已清除過期的 token');
    return { refreshTokens, authTokens };
  }
}
