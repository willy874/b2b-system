import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/** 通知的連結：前端的 route id ＋ 參數（ADR-0026 D3）。路由改名或搬移時舊通知不會壞。 */
export interface NotificationLinkValue {
  route: string;
  params: Record<string, string>;
}

/**
 * 站內通知（docs/architecture/backend/15-notification.md、ADR-0026 D1）：每位收件人一筆。
 *
 * - `type` 是 `<模組>.<事件>`（text ＋ 擁有者模組的常數，與 `defineJob` 同一種命名；不是 Postgres enum，02-database.md §1）。
 * - `params` 只放組句子用的名稱快照，不存整份資料、也不存權限相關的東西。
 * - 收件人被永久刪除時通知一起刪掉（CASCADE）；操作者被永久刪除時通知保留、操作者變成 null
 *   （與 `revisions.actor_id`、`created_by` 同一個規則，13-trash.md §4.2）。
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientId: uuid('recipient_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>().notNull(),
    link: jsonb('link').$type<NotificationLinkValue>(),
    /** 觸發的人；null＝系統（或那個人已被永久刪除）。 */
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 列表（新的在前、keyset 以 id 收尾）與保留清理的「每人超過上限」（依收件人分組、依時間排名）。
    // 欄位用升冪：查詢的 `ORDER BY created_at DESC, id DESC` 由反向掃描取得，NULLS 的位置也對得上
    // （drizzle 的 `.desc()` 會產生 `DESC NULLS LAST`，與查詢預設的 `DESC`（NULLS FIRST）不一致，用不上索引的順序）
    index('notifications_recipient_created_idx').on(t.recipientId, t.createdAt, t.id),
    // 未讀：頂列的未讀數、`unread=true` 的列表、全部已讀；只收未讀的列，索引很小
    index('notifications_recipient_unread_idx')
      .on(t.recipientId, t.createdAt, t.id)
      .where(sql`${t.readAt} IS NULL`),
    // 保留清理的「已讀超過 N 天」
    index('notifications_read_at_idx')
      .on(t.readAt)
      .where(sql`${t.readAt} IS NOT NULL`),
  ],
);

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationInsert = typeof notifications.$inferInsert;
