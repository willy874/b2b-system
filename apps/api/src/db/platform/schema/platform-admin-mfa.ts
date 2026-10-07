import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { platformAdmins } from './platform-admins';

/**
 * 平台管理者的 MFA（docs/architecture/backend/21-mfa.md §3）：欄位與租戶 DB 的 `mfa_factors`、`mfa_challenges`、
 * `mfa_recovery_codes` 相同，帳號欄是 `admin_id`（與 `platform_refresh_tokens` 相同的做法）。
 */
export const platformAdminMfaFactors = pgTable(
  'platform_admin_mfa_factors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    label: text('label'),
    status: text('status').$type<'pending' | 'active'>().notNull(),
    secretEncrypted: text('secret_encrypted'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    lastUsedCounter: bigint('last_used_counter', { mode: 'number' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    interactionUid: text('interaction_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('platform_admin_mfa_factors_admin_idx').on(t.adminId),
    index('platform_admin_mfa_factors_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    check('platform_admin_mfa_factors_status_check', sql`${t.status} IN ('pending', 'active')`),
  ],
);

export const platformAdminMfaChallenges = pgTable(
  'platform_admin_mfa_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'cascade' }),
    factorId: uuid('factor_id')
      .notNull()
      .references(() => platformAdminMfaFactors.id, { onDelete: 'cascade' }),
    purpose: text('purpose').$type<'login' | 'enroll'>().notNull(),
    interactionUid: text('interaction_uid'),
    state: jsonb('state').$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 這個時間之後才能再發一次（Email 的重寄冷卻）。 */
    resendAfter: timestamp('resend_after', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('platform_admin_mfa_challenges_factor_idx').on(t.factorId, t.createdAt.desc()),
    index('platform_admin_mfa_challenges_expires_idx').on(t.expiresAt),
  ],
);

export const platformAdminMfaRecoveryCodes = pgTable(
  'platform_admin_mfa_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('platform_admin_mfa_recovery_codes_admin_hash_key').on(t.adminId, t.codeHash),
  ],
);
