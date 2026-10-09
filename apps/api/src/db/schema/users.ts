import { eq, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  boolean,
  check,
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

/**
 * `locked` 只是對外顯示的狀態（`active` 且 `locked_until` 還沒到期，docs/architecture/backend/04-auth.md §3.3），
 * 不寫進 `users.status`：列舉保留它給 DTO 與篩選用，`users_status_not_locked` 擋住寫入。
 */
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

    /**
     * 衍生欄位：有任一 active 的 MFA 因子時為 true，由 `MfaService` 在新增、移除、重設的同一個交易維護
     * （docs/architecture/backend/21-mfa.md §3）。使用者列表的「MFA」欄與篩選讀它。
     */
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),

    /**
     * 頭像（docs/architecture/backend/25-image.md §15.8）：圖片資產的 id，存參照不存網址（R1）。不設外鍵：`image_assets` 參照
     * `users`（建立者），反過來再參照會讓 schema 循環；資產由 `UserAvatarService` 在同一個交易內認領與解除，
     * 清理排程只刪沒被認領或已解除的資產。
     */
    avatarImageId: uuid('avatar_image_id'),

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
    // 登入失敗的鎖定只寫 locked_until；舊版的 status = 'locked' 已由 migration 0003 改回 active
    check('users_status_not_locked', sql`${t.status} <> 'locked'`),
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
