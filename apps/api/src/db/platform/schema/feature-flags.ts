import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * 全平台層的 feature flag 覆寫（docs/architecture/05-tenancy.md §11.2 D2、D3）：沒有列 = 不覆寫。
 * `off` 是緊急開關，蓋過租戶層；`on` 是全面開放，租戶層仍可以個別關掉。
 */
export const featureFlagOverrides = pgTable(
  'feature_flag_overrides',
  {
    key: text('key').primaryKey(),
    state: text('state').$type<'on' | 'off'>().notNull(),
    /** 最後修改的平台管理者（`platform_admins.id`）；不設外鍵，管理者刪除後紀錄仍在。 */
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('feature_flag_overrides_state_check', sql`${t.state} IN ('on', 'off')`)],
);

export type FeatureFlagOverrideRow = typeof featureFlagOverrides.$inferSelect;
