import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { defineJob, JobQueue } from '@/core/jobs';

import { AuthTokenService } from './auth-token.service';
import { PlatformRefreshTokenRepository } from './platform-refresh-token.repository';
import { RefreshTokenRepository } from './refresh-token.repository';

/** 一批刪幾列：每批一個語句，批與批之間讓出鎖，續期與登入不會被長時間擋住。 */
export const AUTH_TOKEN_CLEANUP_BATCH_SIZE = 5_000;

const CLEANUP_OPTIONS = { exclusive: true, retryLimit: 2, retryDelaySeconds: 300 } as const;

/** 每個租戶的 `refresh_tokens` 與 `auth_tokens`（docs/architecture/backend/04-auth.md §8）。 */
export const AUTH_TOKEN_CLEANUP_JOB = defineJob<Record<string, never>>(
  'auth.tokenCleanup',
  CLEANUP_OPTIONS,
);

/** 平台管理者的 `platform_refresh_tokens`（平台 DB）。 */
export const PLATFORM_TOKEN_CLEANUP_JOB = defineJob<Record<string, never>>(
  'auth.platformTokenCleanup',
  { ...CLEANUP_OPTIONS, scope: 'platform' },
);

/** 反覆刪一批，直到某一批不滿（沒有更多可刪的列）。回傳總筆數。 */
export async function deleteInBatches(
  deleteBatch: (batchSize: number) => Promise<number>,
  batchSize = AUTH_TOKEN_CLEANUP_BATCH_SIZE,
): Promise<number> {
  let total = 0;
  for (;;) {
    // 刻意依序執行：同時刪只會互搶鎖
    // oxlint-disable-next-line no-await-in-loop -- 見上一行
    const deleted = await deleteBatch(batchSize);
    total += deleted;
    if (deleted < batchSize) return total;
  }
}

/**
 * 清除過期的 token（PERF-04）：每次續期都新增一列，不清的話表與索引一路膨脹，續期與登出的成本跟著變高。
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
    const refreshTokens = await deleteInBatches((size) =>
      this.refreshTokens.deleteExpiredBatch(days, size),
    );
    const authTokens = await deleteInBatches((size) =>
      this.authTokens.deleteStaleBatch(days, size),
    );
    this.logger.log({ refreshTokens, authTokens }, '已清除過期的 token');
    return { refreshTokens, authTokens };
  }
}

/** 平台管理者的 refresh token：規則與租戶相同。 */
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
