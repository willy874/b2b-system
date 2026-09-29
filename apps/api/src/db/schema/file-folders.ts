import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';
import { workspaces } from './workspaces';

/**
 * 檔案管理器的資料夾（docs/architecture/backend/09-file.md §4.2）。
 * `parent_id` 為 null 是根目錄底下的資料夾；檔案以 `files.folder_id` 歸屬。
 * 資料夾只是分類：與物件儲存的 key 無關，移動、改名都不必搬物件。
 */
/**
 * 資料夾的種類（docs/rbac/07-resource-grants.md §12）：`normal` 是使用者建立的；其他三種是系統維護、
 * 不能改名／移動／刪除的系統資料夾——共用資料夾、私人資料夾（容器）、每人一個的個人資料夾。
 */
export const FILE_FOLDER_KINDS = ['normal', 'shared', 'privateRoot', 'personal'] as const;
export const fileFolderKind = pgEnum('file_folder_kind', FILE_FOLDER_KINDS);
export type FileFolderKind = (typeof FILE_FOLDER_KINDS)[number];

export const fileFolders = pgTable(
  'file_folders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 資料夾樹以工作區為根（docs/adr/0018-workspace-tenancy.md D7）。 */
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    // 軟刪除：遞迴刪除只標 deleted_at，外鍵不 cascade（已刪除的列仍指向已刪除的父層）。
    // 上層必須在同一個工作區：組合外鍵 file_folders_parent_fk（D10）
    parentId: uuid('parent_id'),
    // false = 中斷繼承（私人資料夾）：上層的資料夾授權不再流到這裡與子孫；全域權限不受影響
    // （docs/rbac/07-resource-grants.md §3.3）
    inheritGrants: boolean('inherit_grants').notNull().default(true),
    kind: fileFolderKind('kind').notNull().default('normal'),
    /** `personal` 的擁有者；其他種類為 null。 */
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'restrict' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // 組合外鍵的參照目標：(workspace_id, id) 讓子資料夾與檔案只能指向同一個工作區的資料夾
    uniqueIndex('file_folders_workspace_id_key').on(t.workspaceId, t.id),
    foreignKey({
      name: 'file_folders_parent_fk',
      columns: [t.workspaceId, t.parentId],
      foreignColumns: [t.workspaceId, t.id],
    }).onDelete('restrict'),
    // 同一層不可同名（不分大小寫）；根目錄的 parent_id 是 null，以全零 uuid 代入才會互相比對
    uniqueIndex('file_folders_parent_name_key')
      .on(
        t.workspaceId,
        sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`lower(${t.name})`,
      )
      .where(sql`${t.deletedAt} IS NULL`),
    index('file_folders_parent_idx')
      .on(t.parentId)
      .where(sql`${t.deletedAt} IS NULL`),
    // 每個工作區的整棵樹（存取判斷每個請求都讀一次）
    index('file_folders_workspace_idx')
      .on(t.workspaceId)
      .where(sql`${t.deletedAt} IS NULL`),
    // 每個工作區的共用資料夾、私人資料夾各只有一個；每個人在每個工作區只有一個個人資料夾
    uniqueIndex('file_folders_singleton_kind_key')
      .on(t.workspaceId, t.kind)
      .where(sql`${t.kind} IN ('shared', 'privateRoot') AND ${t.deletedAt} IS NULL`),
    uniqueIndex('file_folders_personal_owner_key')
      .on(t.workspaceId, t.ownerId)
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
