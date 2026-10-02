import { and, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

/** 標籤的顏色：Design Token 的名稱（與前端 `Chip` 的 tone 相同），不存色碼（docs/architecture/backend/18-tag.md §7.2 D3）。 */
export const TAG_COLORS = ['neutral', 'brand', 'success', 'warning', 'danger'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/**
 * 標籤的定義（docs/architecture/backend/18-tag.md §7.2 D1、D2）：屬於一個標籤組（`scope`，例：`file`、`user`），名稱在組內不分大小寫唯一。
 * 標籤組由擁有者模組在程式碼登記；不認得的組讀取時忽略。刪除是硬刪除，指派隨之 CASCADE（D4）。
 */
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull().default('neutral'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('tags_scope_name_unique').on(t.scope, sql`lower(${t.name})`),
    check(
      'tags_color_check',
      sql`${t.color} IN ('neutral', 'brand', 'success', 'warning', 'danger')`,
    ),
  ],
);

/**
 * 標籤貼在哪個資源上（D2）：多型關聯，`resource_type` 是 `core/resource` 的 `RESOURCE_TYPE`（docs/architecture/backend/14-revisions.md §9.2 D7），
 * 沒有指向資源的外鍵。資源永久刪除時由擁有者清掉（D9）；軟刪除時保留。
 */
export const resourceTags = pgTable(
  'resource_tags',
  {
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.tagId, t.resourceType, t.resourceId] }),
    // 一個資源的標籤（列表組回應）與篩選
    index('resource_tags_resource_idx').on(t.resourceType, t.resourceId),
  ],
);

/**
 * 篩選條件：資源貼了 `tagIds` 之中任一個標籤（docs/architecture/backend/18-tag.md §7.2 D6）。擁有者的 repository 組查詢用，
 * 與 `notDeleted()` 一樣放在 `db/schema/`，讓 `modules/` 不必互相 import repository。
 * 單表的計數查詢裡 Drizzle 會把 `idColumn` 輸出成不帶表名的欄位（例：`"id"`）；`resource_tags` 沒有同名欄位，
 * 它會解析到外層的表——加欄位到 `resource_tags` 時別用 `id` 這類常見名稱。
 */
export function hasAnyTag(
  resourceType: string,
  idColumn: AnyPgColumn,
  tagIds: readonly string[],
): SQL {
  return sql`EXISTS (SELECT 1 FROM ${resourceTags} WHERE ${and(
    eq(resourceTags.resourceType, resourceType),
    eq(resourceTags.resourceId, idColumn),
    inArray(resourceTags.tagId, [...tagIds]),
  )})`;
}

export type TagRow = typeof tags.$inferSelect;
export type TagInsert = typeof tags.$inferInsert;
export type ResourceTagRow = typeof resourceTags.$inferSelect;
