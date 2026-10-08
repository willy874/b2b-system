import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, lte, sql } from 'drizzle-orm';

import { rateLimitCounters } from '@/db/platform/schema';

import { PLATFORM_DB } from '../database';
import type { PlatformDatabase } from '../database';
import { rateLimitStoreDuration } from '../metrics';
import { RateLimitStore } from './rate-limit-store';
import type { RateLimitRecord } from './rate-limit-store';

/** 一次清理刪掉的列數上限：清理不必一次做完，下一輪會接著刪。 */
const CLEANUP_BATCH_SIZE = 5_000;

/**
 * 共享的計數（docs/features/multi-instance.md D6）：平台 DB 的 `rate_limit_counters`（UNLOGGED）。
 * `hit` 是一條 `INSERT … ON CONFLICT DO UPDATE … RETURNING`：一次往返、沒有讀後寫的競態，多個程序同時計數也不會少算。
 * 時間一律用資料庫的時鐘，程序之間的時鐘誤差不影響時間窗。
 */
@Injectable()
export class PostgresRateLimitStore extends RateLimitStore {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {
    super();
  }

  async hit(key: string, windowMs: number): Promise<RateLimitRecord> {
    const end = rateLimitStoreDuration.startTimer({ store: 'postgres', op: 'hit' });
    try {
      const window = sql`(${windowMs}::integer * interval '1 millisecond')`;
      const isOpen = sql`${rateLimitCounters.resetAt} > now()`;
      const [row] = await this.db
        .insert(rateLimitCounters)
        .values({ key, count: 1, resetAt: sql`now() + ${window}`, lastAt: sql`now()` })
        .onConflictDoUpdate({
          target: rateLimitCounters.key,
          set: {
            count: sql`CASE WHEN ${isOpen} THEN ${rateLimitCounters.count} + 1 ELSE 1 END`,
            resetAt: sql`CASE WHEN ${isOpen} THEN ${rateLimitCounters.resetAt} ELSE now() + ${window} END`,
            lastAt: sql`now()`,
          },
        })
        .returning();
      if (!row) throw new Error('rate_limit_counters 的計數沒有回傳列');
      return toRecord(row);
    } finally {
      end();
    }
  }

  async peek(key: string): Promise<RateLimitRecord | undefined> {
    const end = rateLimitStoreDuration.startTimer({ store: 'postgres', op: 'peek' });
    try {
      const [row] = await this.db
        .select()
        .from(rateLimitCounters)
        .where(and(eq(rateLimitCounters.key, key), gt(rateLimitCounters.resetAt, sql`now()`)));
      return row && toRecord(row);
    } finally {
      end();
    }
  }

  async reset(key: string): Promise<void> {
    await this.db.delete(rateLimitCounters).where(eq(rateLimitCounters.key, key));
  }

  /** 刪掉過期的列；回傳刪了幾列（排程 `rateLimit.cleanup`）。 */
  async deleteExpired(): Promise<number> {
    const expired = this.db
      .select({ key: rateLimitCounters.key })
      .from(rateLimitCounters)
      .where(lte(rateLimitCounters.resetAt, sql`now()`))
      .limit(CLEANUP_BATCH_SIZE);
    const deleted = await this.db
      .delete(rateLimitCounters)
      .where(sql`${rateLimitCounters.key} IN (${expired})`)
      .returning({ key: rateLimitCounters.key });
    return deleted.length;
  }
}

function toRecord(row: typeof rateLimitCounters.$inferSelect): RateLimitRecord {
  return { count: row.count, resetAt: row.resetAt.getTime(), lastAt: row.lastAt.getTime() };
}
