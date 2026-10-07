import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 登入成功過的來源（使用者 × IP 前綴；docs/architecture/backend/04-auth.md §3.4）：從這些來源打錯密碼不累計帳號鎖定，
 * 只受登入的漸進延遲限制——知道 email 的人不能從陌生的地方把對方鎖住。IPv4 是完整位址、IPv6 是 /64。
 * 保留 30 天（每天的 `auth.tokenCleanup` 清除）。
 */
export const userLoginSources = pgTable(
  'user_login_sources',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ipPrefix: text('ip_prefix').notNull(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.ipPrefix] }),
    index('user_login_sources_last_success_idx').on(t.lastSuccessAt),
  ],
);
