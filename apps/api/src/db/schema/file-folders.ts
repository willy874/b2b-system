import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 檔案管理器的資料夾（docs/architecture/backend/09-file.md §4.2）。
 * `parent_id` 為 null 是根目錄底下的資料夾；檔案以 `files.folder_id` 歸屬。
 * 資料夾只是分類：與物件儲存的 key 無關，移動、改名都不必搬物件。
 */
export const fileFolders = pgTable(
  'file_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // 軟刪除：遞迴刪除只標 deleted_at，外鍵不 cascade（已刪除的列仍指向已刪除的父層）
    parentId: uuid('parent_id').references((): AnyPgColumn => fileFolders.id, {
      onDelete: 'restrict',
    }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // 同一層不可同名（不分大小寫）；根目錄的 parent_id 是 null，以全零 uuid 代入才會互相比對
    uniqueIndex('file_folders_parent_name_key')
      .on(
        sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`lower(${t.name})`,
      )
      .where(sql`${t.deletedAt} IS NULL`),
    index('file_folders_parent_idx')
      .on(t.parentId)
      .where(sql`${t.deletedAt} IS NULL`),
    // 更深的循環（移到自己的子孫底下）由 service 在交易內檢查（§4.2）
    check('file_folders_not_own_parent', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
);

export type FileFolderRow = typeof fileFolders.$inferSelect;
export type FileFolderInsert = typeof fileFolders.$inferInsert;
