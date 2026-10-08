import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * 速率限制的共享計數（docs/features/multi-instance.md D6）：`RATE_LIMIT_STORE=postgres` 時所有程序共用。
 * migration 手改成 `UNLOGGED`（drizzle 不支援）：不寫 WAL、當機後清空——計數本來就可以丟，換到的是寫入量。
 * 過期的列由排程 `rateLimit.cleanup` 清掉；查詢一律以 `reset_at > now()` 判斷有效，不依賴清理的時機。
 */
export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('rate_limit_counters_reset_at_idx').on(t.resetAt)],
);
