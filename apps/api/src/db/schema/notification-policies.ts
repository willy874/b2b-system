import { boolean, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 租戶層的通知政策（docs/architecture/backend/16-notification-event.md §2、docs/architecture/backend/16-notification-event.md §9.2 D5、D15）：只存 **覆寫值**。
 * 事件與管道的定義在程式碼（`defineNotification()`）。沒有列 = 該事件的 `defaultEnabled` 且允許個人調整；
 * 兩者都回到預設時刪掉那一列。目錄上已經沒有的 `type`／`channel`（事件被移除）讀取時忽略。
 */
export const notificationPolicies = pgTable(
  'notification_policies',
  {
    /** `<模組>.<事件>`，與 `notifications.type` 相同。 */
    type: text('type').notNull(),
    /** `inApp` ｜ `email`。 */
    channel: text('channel').notNull(),
    /** `null`：跟著事件的 `defaultEnabled`（只覆寫了 `allow_user_override`）。 */
    enabled: boolean('enabled'),
    /** `false`：個人不能關（租戶要求每個人都收到）；只在租戶開啟時有意義（docs/architecture/backend/16-notification-event.md §9.2 D14）。 */
    allowUserOverride: boolean('allow_user_override').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [primaryKey({ columns: [t.type, t.channel] })],
);

export type NotificationPolicyRow = typeof notificationPolicies.$inferSelect;
