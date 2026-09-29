import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import type { WorkspaceScope } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { FileFolderInsert, FileFolderKind, FileFolderRow } from '@/db/schema';
import {
  fileFolders,
  files,
  permissions,
  rolePermissions,
  roles,
  users,
  workspaceMemberRoles,
  workspaceMembers,
  workspaces,
} from '@/db/schema';

import type { FolderNode } from './file-access.context';

/**
 * 資料夾結構的寫入以交易層級的 advisory lock 排隊（docs/architecture/backend/09-file.md §4.2）：
 * 兩個人同時把 A 移進 B、把 B 移進 A，各自檢查時都看不到循環，排隊之後第二個就看得到。
 * 資料夾的寫入不頻繁，每個工作區的整棵樹共用一把鎖就夠了（樹以工作區為根，彼此不相干）。
 */
const FOLDER_TREE_LOCK_KEY = 'file_folders_tree';

/** 這個工作區的資料夾（工作區範圍的查詢一律帶上，docs/adr/0018-workspace-tenancy.md D10）。 */
const inWorkspace = (ws: WorkspaceScope) => eq(fileFolders.workspaceId, ws.workspaceId);

@Injectable()
export class FileFolderRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** 取得這個工作區資料夾結構的寫入鎖；交易結束時自動釋放。 */
  async lockTree(ws: WorkspaceScope, tx: DbOrTx): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${FOLDER_TREE_LOCK_KEY}:${ws.workspaceId}`}))`,
    );
  }

  /**
   * 整棵資料夾結構（只取解析授權需要的欄位）：每個檔案請求的存取判斷都要它
   * （docs/architecture/backend/09-file.md §11）。
   */
  async listTreeNodes(ws: WorkspaceScope, tx?: DbOrTx): Promise<FolderNode[]> {
    const db = tx ?? this.db;
    return db
      .select({
        id: fileFolders.id,
        parentId: fileFolders.parentId,
        inheritGrants: fileFolders.inheritGrants,
        createdBy: fileFolders.createdBy,
      })
      .from(fileFolders)
      .where(and(inWorkspace(ws), isNull(fileFolders.deletedAt)));
  }

  /** 移動前的存取判斷：這些檔案所在的資料夾與上傳者（已刪除、還在上傳中的不列）。 */
  async findMovableFiles(
    ws: WorkspaceScope,
    ids: readonly string[],
    tx?: DbOrTx,
  ): Promise<{ id: string; folderId: string | null; createdBy: string | null }[]> {
    if (ids.length === 0) return [];
    const db = tx ?? this.db;
    return db
      .select({ id: files.id, folderId: files.folderId, createdBy: files.createdBy })
      .from(files)
      .where(
        and(
          eq(files.workspaceId, ws.workspaceId),
          inArray(files.id, [...ids]),
          isNull(files.deletedAt),
          eq(files.status, 'ready'),
        ),
      );
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
    ws: WorkspaceScope,
    kind: Extract<FileFolderKind, 'shared' | 'privateRoot'>,
    tx?: DbOrTx,
  ): Promise<FileFolderRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select()
      .from(fileFolders)
      .where(and(inWorkspace(ws), eq(fileFolders.kind, kind), isNull(fileFolders.deletedAt)))
      .limit(1);
    return row;
  }

  /** 把既有的資料夾標成系統資料夾（根目錄已有同名的一般資料夾時沿用它）。 */
  async setKind(id: string, kind: FileFolderKind, tx?: DbOrTx): Promise<void> {
    const db = tx ?? this.db;
    await db.update(fileFolders).set({ kind }).where(eq(fileFolders.id, id));
  }

  /** 這些使用者之中已經在這個工作區有個人資料夾的。 */
  async findPersonalOwnerIds(
    ws: WorkspaceScope,
    userIds: readonly string[],
    tx?: DbOrTx,
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const db = tx ?? this.db;
    const rows = await db
      .select({ ownerId: fileFolders.ownerId })
      .from(fileFolders)
      .where(
        and(
          inWorkspace(ws),
          eq(fileFolders.kind, 'personal'),
          inArray(fileFolders.ownerId, [...userIds]),
          isNull(fileFolders.deletedAt),
        ),
      );
    return new Set(rows.flatMap((row) => (row.ownerId ? [row.ownerId] : [])));
  }

  /**
   * 擁有者已被刪除（軟刪除）的個人資料夾（所有工作區）：`ownerIds` 不帶時找全部（啟動時整理），
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
   * 在這個工作區能進檔案管理器的成員（工作區角色持有 `file:access` 或 `file:read`）：
   * 啟動時補建個人資料夾用。與權限解析（PermissionRepository）同樣只看未刪除的角色。
   * 不是成員的 super-admin 進得去，但不為他建個人資料夾（docs/adr/0018-workspace-tenancy.md D5）。
   */
  async findFileManagerMemberIds(ws: WorkspaceScope): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ id: users.id })
      .from(workspaceMembers)
      .innerJoin(users, and(eq(users.id, workspaceMembers.userId), isNull(users.deletedAt)))
      .innerJoin(
        workspaceMemberRoles,
        and(
          eq(workspaceMemberRoles.workspaceId, workspaceMembers.workspaceId),
          eq(workspaceMemberRoles.userId, workspaceMembers.userId),
        ),
      )
      .innerJoin(roles, and(eq(roles.id, workspaceMemberRoles.roleId), isNull(roles.deletedAt)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, ws.workspaceId),
          inArray(permissions.key, ['file:access', 'file:read']),
        ),
      );
    return rows.map((row) => row.id);
  }

  /** 未刪除的工作區（啟動時逐一整理系統資料夾）。 */
  async listWorkspaceIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(isNull(workspaces.deletedAt));
    return rows.map((row) => row.id);
  }

  /** 這些使用者所屬的（未刪除的）工作區：權限改變時為他們補建個人資料夾。 */
  async findMemberships(
    userIds: readonly string[],
  ): Promise<{ workspaceId: string; userId: string }[]> {
    if (userIds.length === 0) return [];
    return this.db
      .select({ workspaceId: workspaceMembers.workspaceId, userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .innerJoin(
        workspaces,
        and(eq(workspaces.id, workspaceMembers.workspaceId), isNull(workspaces.deletedAt)),
      )
      .where(inArray(workspaceMembers.userId, [...userIds]));
  }

  /** 中斷／恢復繼承。 */
  async setInheritGrants(
    ws: WorkspaceScope,
    id: string,
    values: { inheritGrants: boolean; updatedBy: string },
    tx?: DbOrTx,
  ): Promise<FileFolderRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(fileFolders)
      .set({ ...values, updatedAt: new Date() })
      .where(and(inWorkspace(ws), eq(fileFolders.id, id), isNull(fileFolders.deletedAt)))
      .returning();
    return row;
  }

  /** 這個工作區全部未刪除的資料夾，依名稱排序。 */
  async listAll(ws: WorkspaceScope): Promise<FileFolderRow[]> {
    return this.db
      .select()
      .from(fileFolders)
      .where(and(inWorkspace(ws), isNull(fileFolders.deletedAt)))
      .orderBy(asc(fileFolders.name), asc(fileFolders.id));
  }

  /** 這個工作區的資料夾；別的工作區的 id 一律當作不存在。 */
  async findById(ws: WorkspaceScope, id: string, tx?: DbOrTx): Promise<FileFolderRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select()
      .from(fileFolders)
      .where(and(inWorkspace(ws), eq(fileFolders.id, id), isNull(fileFolders.deletedAt)))
      .limit(1);
    return row;
  }

  async findByIds(
    ws: WorkspaceScope,
    ids: readonly string[],
    tx?: DbOrTx,
  ): Promise<FileFolderRow[]> {
    if (ids.length === 0) return [];
    const db = tx ?? this.db;
    return db
      .select()
      .from(fileFolders)
      .where(
        and(inWorkspace(ws), inArray(fileFolders.id, [...ids]), isNull(fileFolders.deletedAt)),
      );
  }

  /** 這些上層（null 是這個工作區的根目錄）底下的資料夾。 */
  async findChildren(
    ws: WorkspaceScope,
    parentIds: readonly (string | null)[],
    tx?: DbOrTx,
  ): Promise<FileFolderRow[]> {
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
      .where(and(inWorkspace(ws), scope, isNull(fileFolders.deletedAt)));
  }

  /** 從 `id` 往上到根目錄的所有 id（含自己）；上層以組合外鍵保證在同一個工作區。 */
  async findAncestorIds(ws: WorkspaceScope, id: string, tx?: DbOrTx): Promise<string[]> {
    const db = tx ?? this.db;
    const rows = await db.execute<{ id: string }>(sql`
      WITH RECURSIVE chain(id, parent_id) AS (
        SELECT id, parent_id FROM file_folders
        WHERE id = ${id} AND workspace_id = ${ws.workspaceId} AND deleted_at IS NULL
        UNION ALL
        SELECT f.id, f.parent_id FROM file_folders f JOIN chain c ON f.id = c.parent_id
      )
      SELECT id FROM chain
    `);
    return rows.map((row) => row.id);
  }

  /** 這些資料夾與它們所有未刪除的子孫（含自己）；子孫以組合外鍵保證在同一個工作區。 */
  async findDescendantIds(
    ws: WorkspaceScope,
    ids: readonly string[],
    tx?: DbOrTx,
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const db = tx ?? this.db;
    const rows = await db.execute<{ id: string }>(sql`
      WITH RECURSIVE tree(id) AS (
        SELECT id FROM file_folders
        WHERE id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) AND workspace_id = ${ws.workspaceId} AND deleted_at IS NULL
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
    ws: WorkspaceScope,
    id: string,
    values: { name: string; updatedBy: string },
    tx?: DbOrTx,
  ): Promise<FileFolderRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(fileFolders)
      .set({ ...values, updatedAt: new Date() })
      .where(and(inWorkspace(ws), eq(fileFolders.id, id), isNull(fileFolders.deletedAt)))
      .returning();
    return row;
  }

  /** 改變上層；本來就在目的地的不動。回傳實際移動的列。 */
  async move(
    ws: WorkspaceScope,
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
          inWorkspace(ws),
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
    ws: WorkspaceScope,
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
          eq(files.workspaceId, ws.workspaceId),
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
    ws: WorkspaceScope,
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
          inWorkspace(ws),
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
