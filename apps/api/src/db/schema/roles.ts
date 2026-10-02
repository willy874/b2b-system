import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { notDeleted } from './soft-delete';

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(), // 程式碼參照，建立後不可變
    name: text('name').notNull(), // 顯示名稱，可改
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    // 樂觀鎖：名稱與說明每次寫入遞增；持有者與權限鍵（relation_tuples）的寫入不遞增（docs/architecture/backend/14-revisions.md §9.2 D3）
    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('roles_slug_key')
      .on(t.slug)
      .where(sql`${t.deletedAt} IS NULL`),
    // 名稱不分大小寫唯一：`Admin` 與 `admin` 不能並存
    uniqueIndex('roles_name_key')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type RoleRow = typeof roles.$inferSelect;
export type RoleInsert = typeof roles.$inferInsert;

/**
 * 還有效（未軟刪除）的角色＝`notDeleted(roles)` 的別名（docs/architecture/backend/14-revisions.md §9.2 D8）。權限解析、成員與角色列表、
 * 資源授權都只看有效的角色。`core/authz` 的遞迴 CTE 是手寫 SQL，同一個條件寫在那裡（authz.repository.ts）。
 */
export function isActiveRole(): SQL {
  return notDeleted(roles);
}
