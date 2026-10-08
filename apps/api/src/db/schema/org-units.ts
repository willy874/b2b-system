import { sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext } from './custom-types';
import { users } from './users';

/**
 * 組織的部門（docs/architecture/backend/23-organization.md）。以 `parent_id` 的鄰接表表示一棵樹（可以有多個最上層部門），
 * 查詢用遞迴 CTE；部門不是授權來源，不寫進 `relation_tuples`（D1）。
 */
export const orgUnits = pgTable(
  'org_units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** null = 最上層。上層被軟刪除時下層不會跟著刪（刪除前要先沒有下層，D7）。 */
    parentId: uuid('parent_id').references((): AnyPgColumn => orgUnits.id, {
      onDelete: 'restrict',
    }),
    name: text('name').notNull(),
    /** 選填的代碼（匯入、外部系統對應）；未刪除者之間唯一、不分大小寫。 */
    code: citext('code'),
    description: text('description'),
    /** 同一個上層之下的排序，小的在前。 */
    sortOrder: integer('sort_order').notNull().default(0),
    // 樂觀鎖：名稱、代碼、說明、搬移每次寫入遞增；成員的寫入不遞增（docs/architecture/backend/14-revisions.md §9.2 D3）
    version: integer('version').notNull().default(1),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // 同一個上層之下名稱不分大小寫唯一；最上層彼此之間也是（parent_id 為 null 時以固定值代替，NULL 不會互相衝突）
    uniqueIndex('org_units_sibling_name_key')
      .on(
        sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`lower(${t.name})`,
      )
      .where(sql`${t.deletedAt} IS NULL`),
    uniqueIndex('org_units_code_key')
      .on(t.code)
      .where(sql`${t.deletedAt} IS NULL AND ${t.code} IS NOT NULL`),
    index('org_units_parent_idx').on(t.parentId, t.sortOrder),
  ],
);

/**
 * 部門的成員。一個人可以屬於多個部門，其中最多一個是主要部門（主管只沿主要部門往上找，D5）；每個部門可以有多位主管。
 * 使用者被永久刪除時一併刪除（CASCADE）；軟刪除時保留（休眠），解析主管時略過已刪除、未啟用的人。
 */
export const orgUnitMembers = pgTable(
  'org_unit_members',
  {
    unitId: uuid('unit_id')
      .notNull()
      .references(() => orgUnits.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isManager: boolean('is_manager').notNull().default(false),
    isPrimary: boolean('is_primary').notNull().default(false),
    /** 職稱：自由文字，只用來顯示。 */
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    primaryKey({ columns: [t.unitId, t.userId] }),
    // 一人最多一個主要部門
    uniqueIndex('org_unit_members_primary_key')
      .on(t.userId)
      .where(sql`${t.isPrimary}`),
    index('org_unit_members_user_idx').on(t.userId),
  ],
);

export type OrgUnitRow = typeof orgUnits.$inferSelect;
export type OrgUnitInsert = typeof orgUnits.$inferInsert;
export type OrgUnitMemberRow = typeof orgUnitMembers.$inferSelect;
export type OrgUnitMemberInsert = typeof orgUnitMembers.$inferInsert;
