import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * 權限鍵與角色的範圍（docs/adr/0018-workspace-tenancy.md D2、D3）：
 * `platform` 由全域角色持有、全站有效；`workspace` 由工作區角色持有、只在指派的那個工作區有效。
 */
export const PERMISSION_SCOPES = ['platform', 'workspace'] as const;
export const permissionScope = pgEnum('permission_scope', PERMISSION_SCOPES);
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(), // 'role:update'
    resource: text('resource').notNull(),
    action: text('action').notNull(),
    scope: permissionScope('scope').notNull().default('platform'),
    nameI18nKey: text('name_i18n_key').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // I2：key 必須等於 resource:action，由 DB 保證
    check('permissions_key_format', sql`${t.key} = ${t.resource} || ':' || ${t.action}`),
    uniqueIndex('permissions_resource_action_key').on(t.resource, t.action),
    index('permissions_sort_idx').on(t.sortOrder),
  ],
);

export type PermissionRow = typeof permissions.$inferSelect;
