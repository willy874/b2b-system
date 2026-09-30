import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 執行期可調的設定：只存 **覆寫值**。設定的定義（key、schema、預設值、是否公開）在程式碼裡，
 * 沒有列的 key 就是用預設值；還原預設 = 刪掉那一列（docs/architecture/backend/12-settings.md）。
 */
export const systemSettings = pgTable('system_settings', {
  /** `<分類>.<名稱>`，例：`auth.loginMaxAttempts`。 */
  key: text('key').primaryKey(),
  /** 讀取時再以定義的 schema 驗證；不合的值（例：之後收緊了範圍）退回預設值。 */
  value: jsonb('value').$type<string | number | boolean>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export type SystemSettingRow = typeof systemSettings.$inferSelect;
