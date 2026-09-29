import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { permissionScope } from './permissions';

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(), // 程式碼參照，建立後不可變
    name: text('name').notNull(), // 顯示名稱，可改
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    /** 只能含同範圍的權限鍵；`workspace` 角色只能指派在工作區裡（trigger 強制，docs/adr/0018-workspace-tenancy.md D3）。 */
    scope: permissionScope('scope').notNull().default('platform'),

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
    uniqueIndex('roles_name_key')
      .on(t.name)
      .where(sql`${t.deletedAt} IS NULL`),
    index('roles_scope_idx')
      .on(t.scope)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export type RoleRow = typeof roles.$inferSelect;
export type RoleInsert = typeof roles.$inferInsert;
