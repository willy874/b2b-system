import { sql } from 'drizzle-orm';
import { check, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * MFA 方式的全平台層開關（docs/architecture/backend/21-mfa.md §5、D4）：沒有列 = 不覆寫，規則與 `feature_flag_overrides` 相同。
 * `off` 是緊急開關（例：寄信服務故障時關掉 email），蓋過租戶層。不在註冊表的方式讀取時忽略。
 */
export const mfaMethodOverrides = pgTable(
  'mfa_method_overrides',
  {
    method: text('method').primaryKey(),
    state: text('state').$type<'on' | 'off'>().notNull(),
    /** 最後修改的平台管理者；不設外鍵，管理者刪除後紀錄仍在。 */
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('mfa_method_overrides_state_check', sql`${t.state} IN ('on', 'off')`)],
);

/**
 * 各方式已設定的因子數（跨所有租戶加總，平台開關頁用）：每天由平台工作 `mfa.factorStats` 統計，不即時查每個租戶 DB。
 */
export const mfaMethodStats = pgTable('mfa_method_stats', {
  method: text('method').primaryKey(),
  /** 租戶使用者的 active 因子總數。 */
  tenantFactors: integer('tenant_factors').notNull(),
  /** 有至少一個使用者設定了這種方式的租戶數。 */
  tenants: integer('tenants').notNull(),
  /** 平台管理者的 active 因子數。 */
  platformFactors: integer('platform_factors').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MfaMethodOverrideRow = typeof mfaMethodOverrides.$inferSelect;
export type MfaMethodStatsRow = typeof mfaMethodStats.$inferSelect;

/**
 * MFA 方式的平台參數（docs/architecture/backend/21-mfa.md §5.1）：簡訊供應商的金鑰、Bot token、WebAuthn 的 RP 名稱等。
 * 一個方式一列；必填參數沒有填齊之前，方式不能開啟。一般欄位存 `values`，機密欄位以 `MFA_SECRET_KEY`
 * 加密成一段 JSON 存 `secrets_encrypted`（API 只回傳有沒有設定，不回傳值）。
 */
export const mfaMethodSettings = pgTable('mfa_method_settings', {
  method: text('method').primaryKey(),
  values: jsonb('values').$type<Record<string, string>>().notNull().default({}),
  secretsEncrypted: text('secrets_encrypted'),
  /** 樂觀鎖：兩位平台管理者同時改參數時，後送出的要先重新讀取。 */
  version: integer('version').notNull().default(1),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MfaMethodSettingsRow = typeof mfaMethodSettings.$inferSelect;
