import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import type { FileFolderInsert, FileFolderKind, FileFolderRow } from '@/db/schema';
import {
  fileFolders,
  files,
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '@/db/schema';
import { SUPER_ADMIN_SLUG } from '@/modules/permission/permission.constants';

import type { FolderNode } from './file-access.context';

/**
 * 資料夾結構的寫入以交易層級的 advisory lock 排隊（docs/architecture/backend/09-file.md §4.2）：
 * 兩個人同時把 A 移進 B、把 B 移進 A，各自檢查時都看不到循環，排隊之後第二個就看得到。
 * 資料夾的寫入不頻繁，整棵樹共用一把鎖就夠了。
 */
const FOLDER_TREE_LOCK_KEY = 'file_folders_tree';

@Injectable()
export class FileFolderRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 取得資料夾結構的寫入鎖；交易結束時自動釋放。 */
  async lockTree(tx: DbOrTx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${FOLDER_TREE_LOCK_KEY}))`);
  }

  /**
   * 整棵資料夾結構（只取解析授權需要的欄位）：每個檔案請求的存取判斷都要它
   * （docs/architecture/backend/09-file.md §11）。
   */
  async listTreeNodes(tx?: DbOrTx): Promise<FolderNode[]> {
    const db = tx ?? this.db;
    return db
      .select({
        id: fileFolders.id,
        parentId: fileFolders.parentId,
        inheritGrants: fileFolders.inheritGrants,
        createdBy: fileFolders.createdBy,
      })
      .from(fileFolders)
      .where(isNull(fileFolders.deletedAt));
  }

  /** 移動前的存取判斷：這些檔案所在的資料夾與上傳者（已刪除、還在上傳中的不列）。 */
  async findMovableFiles(
    ids: readonly string[],
    tx?: DbOrTx,
  ): Promise<{ id: string; folderId: string | null; createdBy: string | null }[]> {
    if (ids.length === 0) return [];
    const db = tx ?? this.db;
    return db
      .select({ id: files.id, folderId: files.folderId, createdBy: files.createdBy })
      .from(files)
      .where(and(inArray(files.id, [...ids]), isNull(files.deletedAt), eq(files.status, 'ready')));
  }

  /** 這些資料夾（與直接包含的檔案，含上傳中的）之中有沒有不是 `actorId` 建立的。 */
  async hasItemsNotCreatedBy(
    folderIds: readonly string[],
    actorId: string,
    tx?: DbOrTx,
  ): Promise<boolean> {
    if (folderIds.length === 0) return false;
    const db = tx ?? this.db;
    const notMine = (column: typeof files.createdBy | typeof fileFolders.createdBy) =>
      sql`${column} IS DISTINCT FROM ${actorId}::uuid`;
    const [folder] = await db
      .select({ id: fileFolders.id })
      .from(fileFolders)
      .where(and(inArray(fileFolders.id, [...folderIds]), notMine(fileFolders.createdBy)))
      .limit(1);
    if (folder) return true;
    const [file] = await db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          inArray(files.folderId, [...folderIds]),
          isNull(files.deletedAt),
          notMine(files.createdBy),
        ),
      )
      .limit(1);
    return Boolean(file);
  }

  // ── 系統資料夾（docs/rbac/07-resource-grants.md §12）──────────────

  /** 共用資料夾或私人資料夾（各只有一個）。 */
  async findSingleton(
    kind: Extract<FileFolderKind, 'shared' | 'privateRoot'>,
    tx?: DbOrTx,
  ): Promise<FileFolderRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select()
      .from(fileFolders)
      .where(and(eq(fileFolders.kind, kind), isNull(fileFolders.deletedAt)))
      .limit(1);
    return row;
  }

  /** 把既有的資料夾標成系統資料夾（根目錄已有同名的一般資料夾時沿用它）。 */
  async setKind(id: string, kind: FileFolderKind, tx?: DbOrTx): Promise<void> {
    const db = tx ?? this.db;
    await db.update(fileFolders).set({ kind }).where(eq(fileFolders.id, id));
  }

  /** 這些使用者之中已經有個人資料夾的。 */
  async findPersonalOwnerIds(userIds: readonly string[], tx?: DbOrTx): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const db = tx ?? this.db;
    const rows = await db
      .select({ ownerId: fileFolders.ownerId })
      .from(fileFolders)
      .where(
        and(
          eq(fileFolders.kind, 'personal'),
          inArray(fileFolders.ownerId, [...userIds]),
          isNull(fileFolders.deletedAt),
        ),
      );
    return new Set(rows.flatMap((row) => (row.ownerId ? [row.ownerId] : [])));
  }

  /**
   * 擁有者已被刪除（軟刪除）的個人資料夾：`ownerIds` 不帶時找全部（啟動時整理），
   * 帶了只找這些擁有者的（刪除使用者時）。
   */
  async findPersonalOfDeletedOwners(
    ownerIds?: readonly string[],
    tx?: DbOrTx,
  ): Promise<FileFolderRow[]> {
    if (ownerIds?.length === 0) return [];
    const db = tx ?? this.db;
    const rows = await db
      .select({ folder: fileFolders })
      .from(fileFolders)
      .innerJoin(users, eq(users.id, fileFolders.ownerId))
      .where(
        and(
          eq(fileFolders.kind, 'personal'),
          isNull(fileFolders.deletedAt),
          sql`${users.deletedAt} IS NOT NULL`,
          ownerIds ? inArray(fileFolders.ownerId, [...ownerIds]) : undefined,
        ),
      );
    return rows.map((row) => row.folder);
  }

  /** 資料夾裡沒有任何未刪除的子資料夾與檔案（含上傳中的）。 */
  async isEmpty(folderId: string, tx?: DbOrTx): Promise<boolean> {
    const db = tx ?? this.db;
    const [child] = await db
      .select({ id: fileFolders.id })
      .from(fileFolders)
      .where(and(eq(fileFolders.parentId, folderId), isNull(fileFolders.deletedAt)))
      .limit(1);
    if (child) return false;
    const [file] = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.folderId, folderId), isNull(files.deletedAt)))
      .limit(1);
    return !file;
  }

  /** 個人資料夾命名用：未刪除的使用者。 */
  async findUsers(
    userIds: readonly string[],
  ): Promise<{ id: string; displayName: string; email: string }[]> {
    if (userIds.length === 0) return [];
    return this.db
      .select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users)
      .where(and(inArray(users.id, [...userIds]), isNull(users.deletedAt)));
  }

  /**
   * 能進檔案管理器的使用者（持有 `file:access` 或 `file:read` 的角色，或 super-admin）：
   * 啟動時補建個人資料夾用。與權限解析（PermissionRepository）同樣只看未刪除的角色。
   */
  async findFileManagerUserIds(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          isNull(users.deletedAt),
          or(
            eq(roles.slug, SUPER_ADMIN_SLUG),
            inArray(permissions.key, ['file:access', 'file:read']),
          ),
        ),
      );
    return rows.map((row) => row.id);
  }

  /** 中斷／恢復繼承。 */
  async setInheritGrants(
    id: string,
    values: { inheritGrants: boolean; updatedBy: string },
    tx?: DbOrTx,
  ): Promise<FileFolderRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(fileFolders)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(fileFolders.id, id), isNull(fileFolders.deletedAt)))
      .returning();
    return row;
  }

  /** 全部未刪除的資料夾，依名稱排序。 */
  async listAll(): Promise<FileFolderRow[]> {
    return this.db
      .select()
      .from(fileFolders)
      .where(isNull(fileFolders.deletedAt))
      .orderBy(asc(fileFolders.name), asc(fileFolders.id));
  }

  async findById(id: string, tx?: DbOrTx): Promise<FileFolderRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select()
      .from(fileFolders)
      .where(and(eq(fileFolders.id, id), isNull(fileFolders.deletedAt)))
      .limit(1);
    return row;
  }

  async findByIds(ids: readonly string[], tx?: DbOrTx): Promise<FileFolderRow[]> {
    if (ids.length === 0) return [];
    const db = tx ?? this.db;
    return db
      .select()
      .from(fileFolders)
      .where(and(inArray(fileFolders.id, [...ids]), isNull(fileFolders.deletedAt)));
  }

  /** 這些上層（null 是根目錄）底下的資料夾。 */
  async findChildren(parentIds: readonly (string | null)[], tx?: DbOrTx): Promise<FileFolderRow[]> {
    const ids = parentIds.filter((id): id is string => id !== null);
    const includesRoot = parentIds.includes(null);
    const scope = or(
      ids.length > 0 ? inArray(fileFolders.parentId, ids) : undefined,
      includesRoot ? isNull(fileFolders.parentId) : undefined,
    );
    if (!scope) return [];
    const db = tx ?? this.db;
    return db
      .select()
      .from(fileFolders)
      .where(and(scope, isNull(fileFolders.deletedAt)));
  }

  /** 從 `id` 往上到根目錄的所有 id（含自己）。 */
  async findAncestorIds(id: string, tx?: DbOrTx): Promise<string[]> {
    const db = tx ?? this.db;
    const rows = await db.execute<{ id: string }>(sql`
      WITH RECURSIVE chain(id, parent_id) AS (
        SELECT id, parent_id FROM file_folders WHERE id = ${id} AND deleted_at IS NULL
        UNION ALL
        SELECT f.id, f.parent_id FROM file_folders f JOIN chain c ON f.id = c.parent_id
      )
      SELECT id FROM chain
    `);
    return rows.map((row) => row.id);
  }

  /** 這些資料夾與它們所有未刪除的子孫（含自己）。 */
  async findDescendantIds(ids: readonly string[], tx?: DbOrTx): Promise<string[]> {
    if (ids.length === 0) return [];
    const db = tx ?? this.db;
    const rows = await db.execute<{ id: string }>(sql`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM file_folders
        WHERE id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) AND deleted_at IS NULL
        UNION
        SELECT f.id FROM file_folders f JOIN tree t ON f.parent_id = t.id WHERE f.deleted_at IS NULL
      )
      SELECT id FROM tree
    `);
    return rows.map((row) => row.id);
  }

  async create(values: FileFolderInsert[], tx?: DbOrTx): Promise<FileFolderRow[]> {
    if (values.length === 0) return [];
    const db = tx ?? this.db;
    return db.insert(fileFolders).values(values).returning();
  }

  async rename(
    id: string,
    values: { name: string; updatedBy: string },
    tx?: DbOrTx,
  ): Promise<FileFolderRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(fileFolders)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(fileFolders.id, id), isNull(fileFolders.deletedAt)))
      .returning();
    return row;
  }

  /** 改變上層；本來就在目的地的不動。回傳實際移動的列。 */
  async move(
    ids: readonly string[],
    parentId: string | null,
    actorId: string,
    tx?: DbOrTx,
  ): Promise<FileFolderRow[]> {
    if (ids.length === 0) return [];
    const db = tx ?? this.db;
    return db
      .update(fileFolders)
      .set({ parentId, updatedBy: actorId, updatedAt: new Date() })
      .where(
        and(
          inArray(fileFolders.id, [...ids]),
          isNull(fileFolders.deletedAt),
          parentId === null
            ? sql`${fileFolders.parentId} IS NOT NULL`
            : sql`${fileFolders.parentId} IS DISTINCT FROM ${parentId}::uuid`,
        ),
      )
      .returning();
  }

  async softDelete(ids: readonly string[], actorId: string | null, tx?: DbOrTx): Promise<number> {
    if (ids.length === 0) return 0;
    const db = tx ?? this.db;
    const rows = await db
      .update(fileFolders)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(inArray(fileFolders.id, [...ids]), isNull(fileFolders.deletedAt)))
      .returning({ id: fileFolders.id });
    return rows.length;
  }

  /**
   * 把檔案移到資料夾（null 是根目錄）；本來就在目的地、已刪除、還在上傳中的不動。
   * 回傳實際移動的數量。
   */
  async moveFiles(
    fileIds: readonly string[],
    folderId: string | null,
    actorId: string,
    tx?: DbOrTx,
  ): Promise<number> {
    if (fileIds.length === 0) return 0;
    const db = tx ?? this.db;
    const rows = await db
      .update(files)
      .set({ folderId, updatedBy: actorId, updatedAt: new Date() })
      .where(
        and(
          inArray(files.id, [...fileIds]),
          isNull(files.deletedAt),
          eq(files.status, 'ready'),
          folderId === null
            ? sql`${files.folderId} IS NOT NULL`
            : sql`${files.folderId} IS DISTINCT FROM ${folderId}::uuid`,
        ),
      )
      .returning({ id: files.id });
    return rows.length;
  }

  /**
   * 軟刪除這些資料夾「直接」包含的檔案（含上傳中的）。物件儲存裡的內容交給維護排程清除
   * （紀錄已刪除的物件視為孤兒，docs/architecture/backend/09-file.md §9）。
   */
  async softDeleteFilesIn(
    folderIds: readonly string[],
    actorId: string,
    tx?: DbOrTx,
  ): Promise<number> {
    if (folderIds.length === 0) return 0;
    const db = tx ?? this.db;
    const rows = await db
      .update(files)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(inArray(files.folderId, [...folderIds]), isNull(files.deletedAt)))
      .returning({ id: files.id, status: files.status });
    return rows.filter((row) => row.status === 'ready').length;
  }

  /** 同一層是否已有同名（不分大小寫）的資料夾；`exceptId` 是改名中的自己。 */
  async hasSibling(
    parentId: string | null,
    name: string,
    exceptId?: string,
    tx?: DbOrTx,
  ): Promise<boolean> {
    const db = tx ?? this.db;
    const [row] = await db
      .select({ id: fileFolders.id })
      .from(fileFolders)
      .where(
        and(
          parentId === null ? isNull(fileFolders.parentId) : eq(fileFolders.parentId, parentId),
          sql`lower(${fileFolders.name}) = lower(${name})`,
          isNull(fileFolders.deletedAt),
          exceptId ? ne(fileFolders.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}
