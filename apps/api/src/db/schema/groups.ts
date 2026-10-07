import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { notDeleted } from './soft-delete';

/**
 * 群組（docs/architecture/iam/01-model.md §9.3 D11、D12）：純分組，只存名稱與說明。
 * 成員（`group:<id>#member@user:<u>`／`@group:<h>#member`）與群組持有的角色（`role:<r>#holder@group:<id>#member`）
 * 都是 `relation_tuples` 的邊，不另開 `group_members`。
 */
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    // 樂觀鎖：名稱與說明每次寫入遞增；成員與持有的角色（relation_tuples）的寫入不遞增（docs/architecture/backend/14-revisions.md §9.2 D3）
    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // 名稱不分大小寫唯一（與角色相同）
    uniqueIndex('groups_name_key')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type GroupRow = typeof groups.$inferSelect;
export type GroupInsert = typeof groups.$inferInsert;

/**
 * 還有效（未軟刪除）的群組＝`notDeleted(groups)` 的別名。刪除的群組保留成員與持有角色的邊（休眠，還原時回來），
 * 權限解析略過它們。`core/authz` 的遞迴 CTE 是手寫 SQL，同一個條件寫在那裡（authz.repository.ts）。
 */
export function isActiveGroup(): SQL {
  return notDeleted(groups);
}
