import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { rateLimitStoreOf } from '../config/env.schema';
import { LoginThrottle } from './login-throttle';
import { PostgresRateLimitStore } from './postgres-rate-limit-store';
import { RateLimitCleanupJob } from './rate-limit-cleanup.job';
import { MemoryRateLimitStore, RateLimitStore } from './rate-limit-store';

/**
 * 速率限制的計數（全域）：限流 guard、登入的漸進延遲、對外 API 與 WebSocket handshake 共用同一份計數。
 * 實作依 `RATE_LIMIT_STORE`（沒設定時 standalone 用記憶體、cluster 用 Postgres；docs/features/multi-instance.md D6）。
 */
@Global()
@Module({
  providers: [
    MemoryRateLimitStore,
    PostgresRateLimitStore,
    {
      provide: RateLimitStore,
      inject: [ConfigService, MemoryRateLimitStore, PostgresRateLimitStore],
      useFactory: (
        config: ConfigService<Env, true>,
        memory: MemoryRateLimitStore,
        postgres: PostgresRateLimitStore,
      ): RateLimitStore =>
        rateLimitStoreOf({
          RATE_LIMIT_STORE: config.get('RATE_LIMIT_STORE', { infer: true }),
          DEPLOYMENT_MODE: config.get('DEPLOYMENT_MODE', { infer: true }),
        }) === 'postgres'
          ? postgres
          : memory,
    },
    LoginThrottle,
    RateLimitCleanupJob,
  ],
  exports: [RateLimitStore, LoginThrottle],
})
export class RateLimitModule {}
