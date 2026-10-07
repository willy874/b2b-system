import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * 檔案管理器的資料夾（docs/architecture/backend/09-file.md §4.2）。
 * `parent_id` 為 null 是根目錄底下的資料夾；檔案以 `files.folder_id` 歸屬。
 * 資料夾只是分類：與物件儲存的 key 無關，移動、改名都不必搬物件。
 */
/**
 * 資料夾的種類（docs/architecture/iam/06-resource-grants.md §12）：`normal` 是使用者建立的；其他三種是系統維護、
 * 不能改名／移動／刪除的系統資料夾——共用資料夾、私人資料夾（容器）、每人一個的個人資料夾。
 */
export const FILE_FOLDER_KINDS = ['normal', 'shared', 'privateRoot', 'personal'] as const;
export const fileFolderKind = pgEnum('file_folder_kind', FILE_FOLDER_KINDS);
export type FileFolderKind = (typeof FILE_FOLDER_KINDS)[number];

export const fileFolders = pgTable(
  'file_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // 軟刪除：遞迴刪除只標 deleted_at，外鍵不 cascade（已刪除的列仍指向已刪除的父層）
    parentId: uuid('parent_id').references((): AnyPgColumn => fileFolders.id, {
      onDelete: 'restrict',
    }),
    // false = 中斷繼承（私人資料夾）：上層的資料夾授權不再流到這裡與子孫；全域權限不受影響
    // （docs/architecture/iam/06-resource-grants.md §3.3）
    inheritGrants: boolean('inherit_grants').notNull().default(true),
    kind: fileFolderKind('kind').notNull().default('normal'),
    /** `personal` 的擁有者；其他種類為 null。 */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'restrict' }),
    /**
     * 一次刪除操作的識別（docs/architecture/backend/14-revisions.md §9.2 D5）：遞迴刪除的資料夾與其中的檔案帶同一個值，
     * 還原根節點時只還原同一批，之前個別刪掉的子項維持刪除。未刪除時為 null；R4a 之前刪除的列也是 null。
     */
    deletionId: uuid('deletion_id'),

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
    index('file_folders_deletion_id_idx')
      .on(t.deletionId)
      .where(sql`${t.deletedAt} IS NOT NULL`),
    index('file_folders_parent_idx')
      .on(t.parentId)
      .where(sql`${t.deletedAt} IS NULL`),
    // 共用資料夾、私人資料夾各只有一個；每個人只有一個個人資料夾
    uniqueIndex('file_folders_singleton_kind_key')
      .on(t.kind)
      .where(sql`${t.kind} IN ('shared', 'privateRoot') AND ${t.deletedAt} IS NULL`),
    uniqueIndex('file_folders_personal_owner_key')
      .on(t.ownerId)
      .where(sql`${t.kind} = 'personal' AND ${t.deletedAt} IS NULL`),
    check(
      'file_folders_personal_has_owner',
      sql`(${t.kind} = 'personal') = (${t.ownerId} IS NOT NULL)`,
    ),
    // 更深的循環（移到自己的子孫底下）由 service 在交易內檢查（§4.2）
    check('file_folders_not_own_parent', sql`${t.parentId} IS NULL OR ${t.parentId} <> ${t.id}`),
  ],
);

export type FileFolderRow = typeof fileFolders.$inferSelect;
export type FileFolderInsert = typeof fileFolders.$inferInsert;
