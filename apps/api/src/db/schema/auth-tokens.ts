import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const authTokenPurpose = pgEnum('auth_token_purpose', ['activation', 'password_reset']);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: authTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('auth_tokens_hash_key').on(t.tokenHash),
    // 一個使用者同時只有一個有效的同用途 token：發新的時先作廢舊的
    index('auth_tokens_user_purpose_idx')
      .on(t.userId, t.purpose)
      .where(sql`${t.usedAt} IS NULL`),
  ],
);

export type AuthTokenRow = typeof authTokens.$inferSelect;
export type AuthTokenPurpose = (typeof authTokenPurpose.enumValues)[number];
