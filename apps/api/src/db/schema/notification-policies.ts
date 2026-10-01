import { boolean, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 租戶層的通知政策（docs/architecture/backend/16-notification-event.md §2、ADR-0028 D5）：只存 **覆寫值**。
 * 事件與管道的定義在程式碼（`defineNotification()`），沒有列 = 該事件的 `defaultEnabled`；還原預設 = 刪掉那一列。
 * 目錄上已經沒有的 `type`／`channel`（事件被移除）讀取時忽略。
 */
export const notificationPolicies = pgTable(
  'notification_policies',
  {
    /** `<模組>.<事件>`，與 `notifications.type` 相同。 */
    type: text('type').notNull(),
    /** `inApp` ｜ `email`。 */
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.type, t.channel] })],
);

export type NotificationPolicyRow = typeof notificationPolicies.$inferSelect;
