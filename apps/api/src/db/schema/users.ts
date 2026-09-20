import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext } from './custom-types';

export const userStatus = pgEnum('user_status', ['pending', 'active', 'inactive', 'locked']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
    username: citext('username'),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash'), // pending 時為 null
    status: userStatus('status').notNull().default('pending'),

    // 撤銷機制：+1 即讓該使用者所有既存 access token 失效
    tokenVersion: integer('token_version').notNull().default(0),

    // 暴力破解防護
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),

    // 偏好
    locale: text('locale').notNull().default('zh-TW'),
    timezone: text('timezone').notNull().default('Asia/Taipei'),

    mfaEnabled: boolean('mfa_enabled').notNull().default(false), // 預留

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('users_email_key')
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('users_username_key')
      .on(t.username)
      .where(sql`${t.deletedAt} IS NULL AND ${t.username} IS NOT NULL`),
    index('users_status_idx')
      .on(t.status)
      .where(sql`${t.deletedAt} IS NULL`),
    index('users_created_at_idx').on(t.createdAt.desc()),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type UserStatus = (typeof userStatus.enumValues)[number];
