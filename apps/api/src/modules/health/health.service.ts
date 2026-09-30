import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { PlatformDatabase } from '@/core/database';
import { PLATFORM_DB } from '@/core/database';
import { ObjectStorage } from '@/core/storage';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  checks?: Record<string, 'ok' | 'fail'>;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDatabase,
    private readonly storage: ObjectStorage,
  ) {}

  live(): HealthStatus {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async ready(): Promise<HealthStatus> {
    const [database, storage] = await Promise.all([
      this.pingDatabase(),
      this.storage.ping().then((isUp): 'ok' | 'fail' => (isUp ? 'ok' : 'fail')),
    ]);
    return {
      ...this.live(),
      status: database === 'ok' && storage === 'ok' ? 'ok' : 'degraded',
      checks: { database, storage },
    };
  }

  private async pingDatabase(): Promise<'ok' | 'fail'> {
    try {
      await this.db.execute(sql`select 1`);
      return 'ok';
    } catch {
      return 'fail';
    }
  }
}
