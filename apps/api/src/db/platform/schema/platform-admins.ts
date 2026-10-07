import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext } from '../../schema/custom-types';

/** `pending`：由其他平台管理者建立、還沒從啟用信設定密碼（同租戶的 `users.status`）。 */
export const platformAdminStatus = pgEnum('platform_admin_status', [
  'active',
  'inactive',
  'locked',
  'pending',
]);

/**
 * 平台管理者的角色（D5）：固定的三種，權限對照在 `db/seeds/platform-permissions.ts`，沒有自訂角色。
 * 平台的權限範圍很小，每個管理者一個角色就夠。
 */
export const platformAdminRole = pgEnum('platform_admin_role', [
  'super-admin',
  'operator',
  'auditor',
]);

/**
 * 平台管理者（docs/architecture/05-tenancy.md §10.2 D5）：apps/platform 不帶租戶登入時驗證的帳號。
 * 與租戶的 `users` 是兩份資料：同一個 email 在平台與某個租戶是兩個互不相干的帳號。
 */
export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: citext('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash'),
    status: platformAdminStatus('status').notNull().default('active'),
    role: platformAdminRole('role').notNull().default('auditor'),
    /** +1 即讓這個人所有既存的 access token 失效（同 `users.token_version`）。 */
    tokenVersion: integer('token_version').notNull().default(0),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /** 衍生欄位：有任一 active 的 MFA 因子（同 `users.mfa_enabled`）。 */
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('platform_admins_email_key')
      .on(t.email)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

/** 平台管理者在 apps/platform 的 app session（docs/architecture/backend/04-auth.md §10 的 refresh 家族，欄位同租戶的 `refresh_tokens`）。 */
export const platformRefreshTokens = pgTable(
  'platform_refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    /** 家族建立（登入）的時間，輪替時沿用：session 的絕對壽命由它起算。 */
    familyCreatedAt: timestamp('family_created_at', { withTimezone: true }).notNull().defaultNow(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    clientId: text('client_id'),
    idpSessionUid: text('idp_session_uid'),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('platform_refresh_tokens_hash_key').on(t.tokenHash),
    index('platform_refresh_tokens_family_idx').on(t.familyId),
    index('platform_refresh_tokens_family_revoked_idx')
      .on(t.familyId)
      .where(sql`${t.revokedAt} IS NOT NULL`),
    index('platform_refresh_tokens_idp_session_idx')
      .on(t.idpSessionUid)
      .where(sql`${t.idpSessionUid} IS NOT NULL AND ${t.revokedAt} IS NULL`),
  ],
);

/**
 * 平台管理者做過的事（D19）：登入、登出、之後的租戶建立與停用。租戶內的動作寫在各租戶的 `audit_logs`，
 * 平台看不到租戶的稽核。
 */
export const platformAuditLogs = pgTable(
  'platform_audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorEmail: text('actor_email').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    result: text('result').$type<'success' | 'failure'>().notNull(),
    errorCode: text('error_code'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  },
  (t) => [index('platform_audit_logs_occurred_idx').on(t.occurredAt.desc())],
);

/**
 * 平台管理者的啟用與重設密碼 token（同租戶的 `auth_tokens`）。只存雜湊；發新的時先作廢同用途的舊 token。
 */
export const platformAuthTokens = pgTable(
  'platform_auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'cascade' }),
    purpose: text('purpose').$type<PlatformAuthTokenPurpose>().notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('platform_auth_tokens_hash_key').on(t.tokenHash),
    index('platform_auth_tokens_admin_purpose_idx')
      .on(t.adminId, t.purpose)
      .where(sql`${t.usedAt} IS NULL`),
  ],
);

export type PlatformAuthTokenPurpose = 'activation' | 'password_reset';
export type PlatformAdminRow = typeof platformAdmins.$inferSelect;
export type PlatformAdminStatus = (typeof platformAdminStatus.enumValues)[number];
export type PlatformAdminRole = (typeof platformAdminRole.enumValues)[number];
export type PlatformRefreshTokenRow = typeof platformRefreshTokens.$inferSelect;
