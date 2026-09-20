import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(), // 一次登入 = 一條輪替鏈
    tokenHash: text('token_hash').notNull(), // SHA-256(token)，不存明文

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }), // 已輪替
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'), // logout | reuse_detected | user_disabled | password_reset

    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_key').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
    index('refresh_tokens_user_active_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
    index('refresh_tokens_expires_idx').on(t.expiresAt), // 清理排程用
  ],
);

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type RevokedReason = 'logout' | 'reuse_detected' | 'user_disabled' | 'password_reset';
