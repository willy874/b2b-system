import { Global, Inject, Logger, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import {
  connectionLimitsOf,
  createPlatformDatabase,
  PLATFORM_DB,
  PLATFORM_SQL,
} from './database.provider';

type CreatedPlatformDatabase = ReturnType<typeof createPlatformDatabase>;

const PLATFORM_CLIENT = Symbol('PLATFORM_CLIENT');

/**
 * 平台 DB 的連線（docs/architecture/05-tenancy.md §10.2 D1）。
 * 租戶 DB 的連線池由 `core/tenant` 依租戶建立，token 是 `TENANT_DB`。
 */
@Global()
@Module({
  providers: [
    {
      provide: PLATFORM_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): CreatedPlatformDatabase =>
        createPlatformDatabase({
          url: config.get('PLATFORM_DATABASE_URL', { infer: true }),
          max:
            config.get('PLATFORM_POOL_MAX', { infer: true }) ??
            (config.get('NODE_ENV', { infer: true }) === 'production' ? 10 : 3),
          logQueries: false,
          limits: connectionLimitsOf({
            DB_CONNECT_TIMEOUT: config.get('DB_CONNECT_TIMEOUT', { infer: true }),
            DB_STATEMENT_TIMEOUT_MS: config.get('DB_STATEMENT_TIMEOUT_MS', { infer: true }),
            DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: config.get('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', {
              infer: true,
            }),
          }),
        }),
    },
    {
      provide: PLATFORM_DB,
      inject: [PLATFORM_CLIENT],
      useFactory: (created: CreatedPlatformDatabase) => created.db,
    },
    {
      provide: PLATFORM_SQL,
      inject: [PLATFORM_CLIENT],
      useFactory: (created: CreatedPlatformDatabase) => created.client,
    },
  ],
  exports: [PLATFORM_DB, PLATFORM_SQL],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(PLATFORM_CLIENT) private readonly created: CreatedPlatformDatabase) {}

  async onApplicationShutdown(): Promise<void> {
    await this.created.client.end({ timeout: 5 });
    this.logger.log('平台 DB 連線池已關閉');
  }
}
