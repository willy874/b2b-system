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

import { users } from './users';

/**
 * MFA 的因子（docs/architecture/backend/21-mfa.md §3）：與方式無關的一張表（D3），方式自己的東西放
 * `secret_encrypted`（機密）與 `config`（非機密）。**硬刪除**，不進回收桶：憑證不應該能還原。
 * 平台管理者的同一份在平台 DB 的 `platform_admin_mfa_factors`。
 */
export const mfaFactors = pgTable(
  'mfa_factors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 方式 id；不在註冊表的方式（程式移除後）讀取時忽略。 */
    method: text('method').notNull(),
    label: text('label'),
    status: text('status').$type<'pending' | 'active'>().notNull(),
    secretEncrypted: text('secret_encrypted'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    /** TOTP 最後一次接受的時間步（防重放）。 */
    lastUsedCounter: bigint('last_used_counter', { mode: 'number' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    /** 在登入互動中設定時記下：互動作廢時一起清。 */
    interactionUid: text('interaction_uid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('mfa_factors_user_idx').on(t.userId),
    // 清理：pending 的列 24 小時後刪除
    index('mfa_factors_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'pending'`),
    check('mfa_factors_status_check', sql`${t.status} IN ('pending', 'active')`),
  ],
);

/** 由伺服器發出的 challenge（Email 驗證碼）；方式自己的狀態在 `state`。 */
export const mfaChallenges = pgTable(
  'mfa_challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    factorId: uuid('factor_id')
      .notNull()
      .references(() => mfaFactors.id, { onDelete: 'cascade' }),
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
    index('mfa_challenges_factor_idx').on(t.factorId, t.createdAt.desc()),
    index('mfa_challenges_expires_idx').on(t.expiresAt),
  ],
);

/** 一次性備用碼：只存 SHA-256（D15）。 */
export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mfa_recovery_codes_user_hash_key').on(t.userId, t.codeHash)],
);

export type MfaFactorRow = typeof mfaFactors.$inferSelect;
export type MfaChallengeRow = typeof mfaChallenges.$inferSelect;
