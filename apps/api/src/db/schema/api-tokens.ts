import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * API token（docs/architecture/06-external-api.md §9.2 D2、D5、D7）：個人 token 與服務帳號的 token 同一張表，
 * 差別只在 `user_id` 是誰。只存 secret 的 SHA-256；以 id 查到列之後比對雜湊。
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** 管理頁顯示用：token 開頭到 secret 的前 4 碼。 */
    prefix: text('prefix').notNull(),
    secretHash: text('secret_hash').notNull(),
    /** 限縮到的租戶權限鍵；null＝跟著帳號（D3）。 */
    scopes: text('scopes').array(),
    /** 建立當時帳號的 `token_version`：不相等就失效（D5）。 */
    accountVersion: integer('account_version').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    // 管理頁列出一個帳號的 token：未撤銷的在前
    index('api_tokens_user_idx').on(t.userId, t.createdAt.desc()),
    index('api_tokens_active_user_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);

export type ApiTokenRow = typeof apiTokens.$inferSelect;
export type ApiTokenInsert = typeof apiTokens.$inferInsert;
