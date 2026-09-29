import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { roles } from './roles';
import { users } from './users';

/**
 * 工作區：租戶邊界（docs/adr/0018-workspace-tenancy.md）。業務資料都帶 `workspace_id`，
 * 權限鍵分成平台與工作區兩個範圍，工作區範圍的鍵只在指派的工作區有效。
 */
export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 網址用的識別碼（`/w/:slug`），建立後不可變：改了會讓分享出去的連結失效。 */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('workspaces_slug_key')
      .on(t.slug)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

/** 成員資格：工作區範圍的路由只讓成員（與 super-admin）進入（D9）。 */
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    /** 最後一次進入的時間：登入後預設開啟最近用過的工作區。 */
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    // 「這個人屬於哪些工作區」（工作區切換器、權限快取失效）
    index('workspace_members_user_idx').on(t.userId),
  ],
);

/**
 * 成員在工作區裡持有的角色（D11）。以組合外鍵掛在成員資格底下：移除成員時角色跟著消失。
 * 角色必須是 `scope = workspace`（trigger 強制）。
 */
export const workspaceMemberRoles = pgTable(
  'workspace_member_roles',
  {
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId, t.roleId] }),
    foreignKey({
      name: 'workspace_member_roles_member_fk',
      columns: [t.workspaceId, t.userId],
      foreignColumns: [workspaceMembers.workspaceId, workspaceMembers.userId],
    }).onDelete('cascade'),
    // 「誰持有這個角色」：角色權限變更時失效快取
    index('workspace_member_roles_role_idx').on(t.roleId),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type WorkspaceInsert = typeof workspaces.$inferInsert;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type WorkspaceMemberRoleRow = typeof workspaceMemberRoles.$inferSelect;
