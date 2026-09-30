import { Global, Inject, Logger, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { createPlatformDatabase, PLATFORM_DB } from './database.provider';

type CreatedPlatformDatabase = ReturnType<typeof createPlatformDatabase>;

const PLATFORM_CLIENT = Symbol('PLATFORM_CLIENT');

/**
 * 平台 DB 的連線（docs/adr/0020-physical-tenant-isolation.md D1）。
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
          max: config.get('NODE_ENV', { infer: true }) === 'production' ? 10 : 3,
          logQueries: false,
        }),
    },
    {
      provide: PLATFORM_DB,
      inject: [PLATFORM_CLIENT],
      useFactory: (created: CreatedPlatformDatabase) => created.db,
    },
  ],
  exports: [PLATFORM_DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(PLATFORM_CLIENT) private readonly created: CreatedPlatformDatabase) {}

  async onApplicationShutdown(): Promise<void> {
    await this.created.client.end({ timeout: 5 });
    this.logger.log('平台 DB 連線池已關閉');
  }
}
