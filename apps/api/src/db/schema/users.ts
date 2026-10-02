import { eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
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

/**
 * 帳號的種類（docs/architecture/06-external-api.md §9.2 D1）：服務帳號是租戶內的非人類帳號，
 * 沒有密碼、不能登入、不收信，只經 API token 使用；角色、群組、資料夾授權與人相同。
 */
export const userKind = pgEnum('user_kind', ['human', 'service']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
    username: citext('username'),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash'), // pending 時為 null
    status: userStatus('status').notNull().default('pending'),
    kind: userKind('kind').notNull().default('human'),

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

    // 樂觀鎖：可編輯的欄位（username、displayName、status、locale、timezone）每次寫入遞增；
    // 登入計數、鎖定、密碼、token_version 之類的帳號狀態不遞增（docs/architecture/backend/14-revisions.md §9.2 D3）
    version: integer('version').notNull().default(1),

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
    // 使用者列表的關鍵字（ILIKE '%…%'）：btree 用不上，改用 pg_trgm 的 GIN 索引。
    // 運算式要與 user.repository 的查詢一致
    index('users_email_trgm_idx')
      .using('gin', sql`(${t.email}::text) gin_trgm_ops`)
      .where(sql`${t.deletedAt} IS NULL`),
    index('users_username_trgm_idx')
      .using('gin', sql`(${t.username}::text) gin_trgm_ops`)
      .where(sql`${t.deletedAt} IS NULL`),
    index('users_display_name_trgm_idx')
      .using('gin', sql`${t.displayName} gin_trgm_ops`)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

/**
 * 「人」的帳號：使用者列表、人數、最後一位 super-admin、登入與寄信都只看人，不看服務帳號
 * （docs/architecture/06-external-api.md §9.2 D1）。與 `notDeleted()` 一樣在查詢裡組合使用。
 */
export function isHumanUser(): SQL {
  return eq(users.kind, 'human');
}

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type UserStatus = (typeof userStatus.enumValues)[number];
export type UserKind = (typeof userKind.enumValues)[number];
