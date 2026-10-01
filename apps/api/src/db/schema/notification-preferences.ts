import { boolean, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 個人的通知設定（docs/architecture/backend/16-notification-event.md §5、ADR-0028 D15）：只存 **覆寫值**。
 * 沒有列 = 跟著租戶的生效值；只在租戶開啟且允許個人調整時生效（D14）。租戶之後收回時列保留但不生效，
 * 再次允許時恢復。使用者被永久刪除時一起刪掉。
 */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `<模組>.<事件>`，與 `notifications.type` 相同。 */
    type: text('type').notNull(),
    /** `inApp` ｜ `email`。 */
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type, t.channel] })],
);

export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;
