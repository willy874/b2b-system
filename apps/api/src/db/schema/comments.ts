import { sql } from 'drizzle-orm';
import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 資源上的留言（docs/architecture/backend/24-comment.md §2）：多型關聯，`resource_type` 是 `core/resource` 的 `RESOURCE_TYPE`
 * （docs/architecture/backend/14-revisions.md §9.2 D7），沒有指向資源的外鍵。資源軟刪除時保留，永久刪除時由擁有者清掉（D10）。
 * 刪除留言是硬刪除（D5），所以沒有 `deleted_at`。
 */
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    /** 作者被永久刪除時留言保留、作者變成 null（與 `created_by` 同一個規則，docs/architecture/backend/13-trash.md §4.2）。 */
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    /** @提及的人（D6）：沒有外鍵，被永久刪除的人讀取時自然消失。 */
    mentions: uuid('mentions')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    version: integer('version').notNull().default(1),
    /** 作者最後一次編輯的時間；null＝沒有編輯過。 */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 一個資源的留言列表（新的在前，keyset）與永久刪除時的清理
    index('comments_resource_created_idx').on(t.resourceType, t.resourceId, t.createdAt, t.id),
    // 作者被永久刪除時的 SET NULL
    index('comments_author_idx').on(t.authorId),
  ],
);

/**
 * 誰關注了哪個資源（D7）：資源有新留言或被修改時通知。使用者被永久刪除時一起刪除。
 */
export const watches = pgTable(
  'watches',
  {
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.resourceType, t.resourceId, t.userId] }),
    // 使用者被刪除時的 CASCADE
    index('watches_user_idx').on(t.userId),
  ],
);

export type CommentRow = typeof comments.$inferSelect;
export type CommentInsert = typeof comments.$inferInsert;
export type WatchRow = typeof watches.$inferSelect;
