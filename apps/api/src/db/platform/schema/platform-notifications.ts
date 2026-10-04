import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { platformAdmins } from './platform-admins';

/** 通知的連結：apps/platform 的 route id ＋ 參數（同租戶的 `NotificationLinkValue`）。路由改名或搬移時舊通知不會壞。 */
export interface PlatformNotificationLinkValue {
  route: string;
  params: Record<string, string>;
}

/**
 * 平台管理者的站內通知（docs/architecture/backend/15-notification.md §6.2）：每位收件人一筆，規則與租戶的 `notifications` 相同。
 *
 * - `type` 是 `<模組>.<事件>`（text ＋ 擁有者模組的常數，不是 Postgres enum）。
 * - `params` 只放組句子用的名稱快照（租戶代碼、角色），不存整份資料。
 * - 收件人被刪除時通知一起刪掉（CASCADE）；平台的通知都是系統發出的，沒有操作者欄位。
 */
export const platformNotifications = pgTable(
  'platform_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    link: jsonb('link').$type<PlatformNotificationLinkValue>(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 列表（新的在前）；欄位用升冪，`ORDER BY created_at DESC, id DESC` 由反向掃描取得（同租戶的 notifications）
    index('platform_notifications_recipient_created_idx').on(t.recipientId, t.createdAt, t.id),
    // 頂列的未讀數、只看未讀、全部已讀
    index('platform_notifications_recipient_unread_idx')
      .on(t.recipientId, t.createdAt, t.id)
      .where(sql`${t.readAt} IS NULL`),
    // 保留清理的「已讀超過 N 天」
    index('platform_notifications_read_at_idx')
      .on(t.readAt)
      .where(sql`${t.readAt} IS NOT NULL`),
  ],
);

export type PlatformNotificationRow = typeof platformNotifications.$inferSelect;
