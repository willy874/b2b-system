import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@/core/database';
import { DRIZZLE } from '@/core/database';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  checks?: Record<string, 'ok' | 'fail'>;
}

@Injectable()
export class HealthService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  live(): HealthStatus {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async ready(): Promise<HealthStatus> {
    const database = await this.pingDatabase();
    return {
      ...this.live(),
      status: database === 'ok' ? 'ok' : 'degraded',
      checks: { database },
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
