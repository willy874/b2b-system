import { Global, Inject, Logger, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { createDatabase, DRIZZLE, PG_CLIENT } from './database.provider';

type CreatedDatabase = ReturnType<typeof createDatabase>;

@Global()
@Module({
  providers: [
    {
      provide: PG_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): CreatedDatabase =>
        createDatabase({
          url: config.get('DATABASE_URL', { infer: true }),
          max: config.get('NODE_ENV', { infer: true }) === 'production' ? 20 : 5,
          logQueries: false,
        }),
    },
    {
      provide: DRIZZLE,
      inject: [PG_CLIENT],
      useFactory: (created: CreatedDatabase) => created.db,
    },
  ],
  exports: [DRIZZLE, PG_CLIENT],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(PG_CLIENT) private readonly created: CreatedDatabase) {}

  async onApplicationShutdown(): Promise<void> {
    await this.created.client.end({ timeout: 5 });
    this.logger.log('PostgreSQL 連線池已關閉');
  }
}
