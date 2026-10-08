import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { defineJob, JobQueue } from '../jobs';
import { PostgresRateLimitStore } from './postgres-rate-limit-store';
import { RateLimitStore } from './rate-limit-store';

/** 共享計數的過期列清理（docs/architecture/01-system.md §7 D6）；記憶體實作時什麼都不做。 */
export const RATE_LIMIT_CLEANUP_JOB = defineJob<Record<string, never>>('rateLimit.cleanup', {
  exclusive: true,
  retryLimit: 0,
  scope: 'platform',
});

@Injectable()
export class RateLimitCleanupJob implements OnModuleInit {
  private readonly logger = new Logger(RateLimitCleanupJob.name);

  constructor(
    private readonly jobs: JobQueue,
    private readonly store: RateLimitStore,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    this.jobs.register(RATE_LIMIT_CLEANUP_JOB, () => this.run(), {
      cron: this.config.get('RATE_LIMIT_CLEANUP_CRON', { infer: true }),
    });
  }

  async run(): Promise<{ deleted: number }> {
    if (!(this.store instanceof PostgresRateLimitStore)) return { deleted: 0 };
    const deleted = await this.store.deleteExpired();
    if (deleted > 0) this.logger.log({ deleted }, '已清除過期的速率限制計數');
    return { deleted };
  }
}
