import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database, DbOrTx } from '@/core/database';
import { containsPattern, TENANT_DB } from '@/core/database';
import type { FileFolderInsert, FileFolderKind, FileFolderRow } from '@/db/schema';
import {
  fileFolders,
  files,
  isDeleted,
  isHumanUser,
  notDeleted,
  relationTuples,
  users,
} from '@/db/schema';

import type { FolderNode } from './file-access.context';

/**
 * 資料夾結構的寫入以交易層級的 advisory lock 排隊（docs/architecture/backend/09-file.md §4.2）：
 * 兩個人同時把 A 移進 B、把 B 移進 A，各自檢查時都看不到循環，排隊之後第二個就看得到。
 * 資料夾的寫入不頻繁，整棵樹共用一把鎖就夠了。
 */
const FOLDER_TREE_LOCK_KEY = 'file_folders_tree';

/** 關係圖上資料夾的物件型別（file.authz.ts 的 `FILE_FOLDER_TYPE`）。 */
const FOLDER_OBJECT_TYPE = 'fileFolder';

/** 遞迴查詢的深度上限：擋住壞資料的循環（正常的樹最多 `MAX_FOLDER_DEPTH` 層）。 */
const RECURSION_LIMIT = 64;

/** 一次刪除操作的識別與時間（docs/architecture/backend/14-revisions.md §9.2 D5）：遞迴刪除的資料夾與檔案帶同一組值。 */
export interface DeletionStamp {
  actorId: string | null;
  deletionId: string;
  deletedAt: Date;
}

/** 回收桶的一列（`listDeleted`）。 */
export interface DeletedFolderRow {
  id: string;
  name: string;
  parentId: string | null;
  deletedAt: Date;
  deletedBy: { id: string; name: string } | null;
}

const deleter = alias(users, 'deleter');

/**
 * 一批刪除的根：上層不是 **同一次刪除** 刪掉的（docs/architecture/backend/14-revisions.md §9.2 D5）。遞迴刪除的子孫屬於根的批次，回收桶只列根。
 * R4a 之前刪除的列 `deletion_id` 是 null，以 `IS NOT DISTINCT FROM` 比對：舊的遞迴刪除整棵視為同一批。
 */
const BATCH_ROOT = sql`NOT EXISTS (
  SELECT 1 FROM ${fileFolders} AS parent_folder
  WHERE parent_folder.id = ${fileFolders.parentId}
    AND parent_folder.deleted_at IS NOT NULL
    AND parent_folder.deletion_id IS NOT DISTINCT FROM ${fileFolders.deletionId}
)`;

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
        kind: fileFolders.kind,
        ownerId: fileFolders.ownerId,
      })
      .from(fileFolders)
      .where(notDeleted(fileFolders));
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
      .where(and(inArray(files.id, [...ids]), notDeleted(files), eq(files.status, 'ready')));
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
        and(inArray(files.folderId, [...folderIds]), notDeleted(files), notMine(files.createdBy)),
      )
      .limit(1);
    return Boolean(file);
  }

  // ── 系統資料夾（docs/architecture/iam/06-resource-grants.md §12）──────────────

  /** 共用資料夾或私人資料夾（各只有一個）。 */
  async findSingleton(
    kind: Extract<FileFolderKind, 'shared' | 'privateRoot'>,
    tx?: DbOrTx,
  ): Promise<FileFolderRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select()
      .from(fileFolders)
      .where(and(eq(fileFolders.kind, kind), notDeleted(fileFolders)))
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
          notDeleted(fileFolders),
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
          notDeleted(fileFolders),
          isDeleted(users),
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
      .where(and(eq(fileFolders.parentId, folderId), notDeleted(fileFolders)))
      .limit(1);
    if (child) return false;
    const [file] = await db
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.folderId, folderId), notDeleted(files)))
      .limit(1);
    return !file;
  }

  /** 個人資料夾命名用：未刪除的人（服務帳號沒有個人資料夾，docs/architecture/06-external-api.md §9.2 D1）。 */
  async findUsers(
    userIds: readonly string[],
  ): Promise<{ id: string; displayName: string; email: string }[]> {
    if (userIds.length === 0) return [];
    return this.db
      .select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users)
      .where(and(inArray(users.id, [...userIds]), notDeleted(users), isHumanUser()));
  }

  /** 未刪除的人：啟動時補建個人資料夾的候選人（能不能進檔案管理器由權限解析決定）。 */
  async findActiveUserIds(): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(notDeleted(users), isHumanUser()));
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
      .where(and(eq(fileFolders.id, id), notDeleted(fileFolders)))
      .returning();
    return row;
  }

  /** 全部未刪除的資料夾，依名稱排序。 */
  async listAll(): Promise<FileFolderRow[]> {
    return this.db
      .select()
      .from(fileFolders)
      .where(notDeleted(fileFolders))
      .orderBy(asc(fileFolders.name), asc(fileFolders.id));
  }

  async findById(id: string, tx?: DbOrTx): Promise<FileFolderRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select()
      .from(fileFolders)
      .where(and(eq(fileFolders.id, id), notDeleted(fileFolders)))
      .limit(1);
    return row;
  }

  async findByIds(ids: readonly string[], tx?: DbOrTx): Promise<FileFolderRow[]> {
    if (ids.length === 0) return [];
    const db = tx ?? this.db;
    return db
      .select()
      .from(fileFolders)
      .where(and(inArray(fileFolders.id, [...ids]), notDeleted(fileFolders)));
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
      .where(and(scope, notDeleted(fileFolders)));
  }

  /** 從 `id` 往上到根目錄的所有 id（含自己）。 */
  async findAncestorIds(id: string, tx?: DbOrTx): Promise<string[]> {
    const db = tx ?? this.db;
    const rows = await db.execute<{ id: string }>(sql`
      WITH RECURSIVE chain(id, parent_id) AS (
        SELECT id, parent_id FROM file_folders WHERE id = ${id} AND deleted_at IS NULL /* notDeleted */
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
        )}) AND deleted_at IS NULL /* notDeleted */
        UNION
        SELECT f.id FROM file_folders f JOIN tree t ON f.parent_id = t.id WHERE f.deleted_at IS NULL /* notDeleted */
      )
      SELECT id FROM tree
    `);
    return rows.map((row) => row.id);
  }

  /**
   * 這些資料夾的子樹高度中最大的一個（只有自己 = 1；不存在 = 0）。`limit` 擋住壞資料的循環。
   */
  async findMaxSubtreeHeight(ids: readonly string[], limit: number, tx?: DbOrTx): Promise<number> {
    if (ids.length === 0) return 0;
    const db = tx ?? this.db;
    const [row] = await db.execute<{ height: number }>(sql`
      WITH RECURSIVE tree(id, depth) AS (
        SELECT id, 1 FROM file_folders
        WHERE id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) AND deleted_at IS NULL /* notDeleted */
        UNION ALL
        SELECT f.id, t.depth + 1 FROM file_folders f JOIN tree t ON f.parent_id = t.id
        WHERE f.deleted_at IS NULL /* notDeleted */ AND t.depth < ${limit}
      )
      SELECT coalesce(max(depth), 0)::int AS height FROM tree
    `);
    return row?.height ?? 0;
  }

  async create(values: FileFolderInsert[], tx?: DbOrTx): Promise<FileFolderRow[]> {
    if (values.length === 0) return [];
    const db = tx ?? this.db;
    return db.insert(fileFolders).values(values).returning();
  }

  /** 同 `create`，但撞到唯一索引（同層同名、個人資料夾的擁有者）的列直接略過；回傳實際寫入的列。 */
  async createSkippingConflicts(values: FileFolderInsert[], tx: DbOrTx): Promise<FileFolderRow[]> {
    if (values.length === 0) return [];
    return tx.insert(fileFolders).values(values).onConflictDoNothing().returning();
  }

  /** 某一層底下未刪除的資料夾名稱（`lower()` 之後，與同層唯一索引的比對方式相同）。 */
  async findChildNames(parentId: string, tx?: DbOrTx): Promise<Set<string>> {
    const db = tx ?? this.db;
    const rows = await db
      .select({ name: sql<string>`lower(${fileFolders.name})` })
      .from(fileFolders)
      .where(and(eq(fileFolders.parentId, parentId), notDeleted(fileFolders)));
    return new Set(rows.map((row) => row.name));
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
      .where(and(eq(fileFolders.id, id), notDeleted(fileFolders)))
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
          notDeleted(fileFolders),
          parentId === null
            ? sql`${fileFolders.parentId} IS NOT NULL`
            : sql`${fileFolders.parentId} IS DISTINCT FROM ${parentId}::uuid`,
        ),
      )
      .returning();
  }

  /** 軟刪除；同一次刪除的列帶同一個 `deletionId`（docs/architecture/backend/14-revisions.md §9.2 D5）。 */
  async softDelete(ids: readonly string[], stamp: DeletionStamp, tx?: DbOrTx): Promise<number> {
    if (ids.length === 0) return 0;
    const db = tx ?? this.db;
    const rows = await db
      .update(fileFolders)
      .set({ deletedAt: stamp.deletedAt, updatedBy: stamp.actorId, deletionId: stamp.deletionId })
      .where(and(inArray(fileFolders.id, [...ids]), notDeleted(fileFolders)))
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
          notDeleted(files),
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
   * 軟刪除這些資料夾「直接」包含的檔案（含上傳中的），與資料夾帶同一個 `deletionId`。物件儲存裡的內容保留到
   * 回收桶的保留期限結束，由 `trash.purge` 在永久刪除後清掉（docs/architecture/backend/13-trash.md §7）。
   */
  async softDeleteFilesIn(
    folderIds: readonly string[],
    stamp: DeletionStamp,
    tx?: DbOrTx,
  ): Promise<number> {
    if (folderIds.length === 0) return 0;
    const db = tx ?? this.db;
    const rows = await db
      .update(files)
      .set({ deletedAt: stamp.deletedAt, updatedBy: stamp.actorId, deletionId: stamp.deletionId })
      .where(and(inArray(files.folderId, [...folderIds]), notDeleted(files)))
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
    return Boolean(await this.findSiblingId(parentId, name, exceptId, tx));
  }

  /** 同一層同名（不分大小寫）、未刪除的資料夾 id：還原時帶進錯誤的 `details.conflictingId`。 */
  async findSiblingId(
    parentId: string | null,
    name: string,
    exceptId?: string,
    tx?: DbOrTx,
  ): Promise<string | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select({ id: fileFolders.id })
      .from(fileFolders)
      .where(
        and(
          parentId === null ? isNull(fileFolders.parentId) : eq(fileFolders.parentId, parentId),
          sql`lower(${fileFolders.name}) = lower(${name})`,
          notDeleted(fileFolders),
          exceptId ? ne(fileFolders.id, exceptId) : undefined,
        ),
      )
      .limit(1);
    return row?.id;
  }

  // ── 回收桶與還原（docs/architecture/backend/14-revisions.md §9.2 D5、D9、D11）：這一段故意讀已刪除的列，一律用 isDeleted() ──

  /** 已刪除的資料夾；不存在或沒有被刪除回 undefined。 */
  async findDeletedById(id: string, tx?: DbOrTx): Promise<FileFolderRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(fileFolders)
      .where(and(eq(fileFolders.id, id), isDeleted(fileFolders)))
      .limit(1);
    return row;
  }

  /** 資料夾是否已刪除（不存在也當作已刪除：已被永久刪除）。還原時判斷上層還在不在。 */
  async isDeletedOrGone(id: string, tx?: DbOrTx): Promise<boolean> {
    return !(await this.findById(id, tx));
  }

  /**
   * 同一次刪除的子樹（含根）：從根往下，只走已刪除、`deletion_id` 相同的資料夾（docs/architecture/backend/14-revisions.md §9.2 D5）。
   * 之前個別刪掉的子資料夾 `deletion_id` 不同，連同它底下的都不在這一批。null 是 R4a 之前的刪除。
   */
  async findDeletedBatchIds(
    rootId: string,
    deletionId: string | null,
    tx?: DbOrTx,
  ): Promise<string[]> {
    const rows = await (tx ?? this.db).execute<{ id: string }>(sql`
      WITH RECURSIVE batch(id, depth) AS (
        SELECT id, 0 FROM file_folders WHERE id = ${rootId} AND deleted_at IS NOT NULL
        UNION ALL
        SELECT f.id, b.depth + 1 FROM file_folders f JOIN batch b ON f.parent_id = b.id
        WHERE f.deleted_at IS NOT NULL
          AND f.deletion_id IS NOT DISTINCT FROM ${deletionId}::uuid
          AND b.depth < ${RECURSION_LIMIT}
      )
      SELECT id FROM batch
    `);
    return rows.map((row) => row.id);
  }

  /**
   * 清掉 `deleted_at` 與 `deletion_id`（只在仍是同一批已刪除時；並行的兩個還原只有一個命中）。
   * 資料夾上的授權（`relation_tuples`）刪除時沒有動過，隨之生效（docs/architecture/backend/13-trash.md §7.1）。
   */
  async restore(
    ids: readonly string[],
    values: { actorId: string; deletionId: string | null },
    tx: DbOrTx,
  ): Promise<FileFolderRow[]> {
    if (ids.length === 0) return [];
    return tx
      .update(fileFolders)
      .set({ deletedAt: null, deletionId: null, updatedBy: values.actorId, updatedAt: new Date() })
      .where(
        and(
          inArray(fileFolders.id, [...ids]),
          isDeleted(fileFolders),
          sql`${fileFolders.deletionId} IS NOT DISTINCT FROM ${values.deletionId}::uuid`,
        ),
      )
      .returning();
  }

  /**
   * 從每個資料夾往上到根目錄的名稱（含自己，已刪除的也算）：回收桶顯示「原本在哪裡」。
   * 回傳 id → 由根往下的名稱。
   */
  async findPaths(ids: readonly string[]): Promise<Map<string, string[]>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.db.execute<{ start_id: string; name: string; depth: number }>(sql`
      WITH RECURSIVE chain(start_id, id, parent_id, name, depth) AS (
        SELECT id, id, parent_id, name, 0 FROM file_folders
        WHERE id IN (${sql.join(
          unique.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        UNION ALL
        SELECT c.start_id, f.id, f.parent_id, f.name, c.depth + 1
        FROM file_folders f JOIN chain c ON f.id = c.parent_id
        WHERE c.depth < ${RECURSION_LIMIT}
      )
      SELECT start_id, name, depth FROM chain
    `);
    const paths = new Map<string, Array<{ name: string; depth: number }>>();
    for (const row of rows) {
      const list = paths.get(row.start_id) ?? [];
      list.push({ name: row.name, depth: Number(row.depth) });
      paths.set(row.start_id, list);
    }
    return new Map(
      [...paths].map(([id, list]) => [
        id,
        list.toSorted((a, b) => b.depth - a.depth).map((entry) => entry.name),
      ]),
    );
  }

  /**
   * 回收桶：每一批刪除的根（`BATCH_ROOT`），不列跟著上層一起刪的子孫。系統資料夾（共用、私人、個人）只由系統刪除
   * （擁有者被刪除時的空個人資料夾），不能還原，不列（iam/06 §12）。
   */
  async listDeleted(query: {
    offset: number;
    limit: number;
    keyword?: string;
  }): Promise<{ items: DeletedFolderRow[]; total: number }> {
    const conditions: SQL[] = [isDeleted(fileFolders), eq(fileFolders.kind, 'normal'), BATCH_ROOT];
    if (query.keyword) conditions.push(ilike(fileFolders.name, containsPattern(query.keyword)));
    const where = and(...conditions);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: fileFolders.id,
          name: fileFolders.name,
          parentId: fileFolders.parentId,
          deletedAt: fileFolders.deletedAt,
          deleterId: deleter.id,
          deleterName: deleter.displayName,
        })
        .from(fileFolders)
        .leftJoin(deleter, eq(deleter.id, fileFolders.updatedBy))
        .where(where)
        .orderBy(desc(fileFolders.deletedAt), desc(fileFolders.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(fileFolders)
        .where(where),
    ]);
    return {
      items: rows.flatMap(({ deleterId, deleterName, deletedAt, ...row }) =>
        deletedAt
          ? [
              {
                ...row,
                deletedAt,
                deletedBy: deleterId && deleterName ? { id: deleterId, name: deleterName } : null,
              },
            ]
          : [],
      ),
      total: counted?.total ?? 0,
    };
  }

  /**
   * 刪除超過保留期限的資料夾子樹的根（依 id 的 keyset；docs/architecture/backend/14-revisions.md §9.2 D11）：上層也到期的不回傳，由上層的 `purgeTree` 一起刪。
   * 上層到期 ⇒ 子孫也到期：子孫不是與上層同時刪除，就是更早個別刪除（上層被刪之後不可能再有東西被刪）。
   * 含系統刪除的個人資料夾：它們清掉之後，擁有者才能被永久刪除（`file_folders.owner_id` 是 `RESTRICT`）。
   */
  async findExpired(
    cutoff: Date,
    afterId: string | null,
    limit: number,
  ): Promise<Array<{ id: string; name: string; deletedAt: Date }>> {
    const rows = await this.db
      .select({ id: fileFolders.id, name: fileFolders.name, deletedAt: fileFolders.deletedAt })
      .from(fileFolders)
      .where(
        and(
          isDeleted(fileFolders),
          lt(fileFolders.deletedAt, cutoff),
          afterId ? gt(fileFolders.id, afterId) : undefined,
          sql`NOT EXISTS (
            SELECT 1 FROM ${fileFolders} AS parent_folder
            WHERE parent_folder.id = ${fileFolders.parentId}
              AND parent_folder.deleted_at IS NOT NULL
              AND parent_folder.deleted_at < ${cutoff.toISOString()}::timestamptz
          )`,
        ),
      )
      .orderBy(asc(fileFolders.id))
      .limit(limit);
    return rows.flatMap(({ deletedAt, ...row }) => (deletedAt ? [{ ...row, deletedAt }] : []));
  }

  /**
   * 永久刪除一個已刪除的資料夾與它所有已刪除的子孫（在呼叫端的交易內；docs/architecture/backend/13-trash.md §7.3）。
   * `parent_id` 是 `RESTRICT`：由最深的一層往上刪。其中的檔案（`files.folder_id` 也是 `RESTRICT`）要先被檔案的 handler
   * 清掉，還有剩（或有未刪除的子孫）時外鍵違反，由呼叫端的 savepoint 當作這一輪略過。
   * 關係圖以這些資料夾為物件的邊（資料夾授權）一併刪除。回傳刪掉的資料夾 id（空的代表已被還原或已不在）。
   */
  async purgeTree(rootId: string, tx: DbOrTx): Promise<string[]> {
    const rows = await tx.execute<{ id: string; depth: number }>(sql`
      WITH RECURSIVE tree(id, depth) AS (
        SELECT id, 0 FROM file_folders WHERE id = ${rootId} AND deleted_at IS NOT NULL
        UNION ALL
        SELECT f.id, t.depth + 1 FROM file_folders f JOIN tree t ON f.parent_id = t.id
        WHERE f.deleted_at IS NOT NULL AND t.depth < ${RECURSION_LIMIT}
      )
      SELECT id, depth FROM tree
    `);
    if (rows.length === 0) return [];
    const byDepth = new Map<number, string[]>();
    for (const row of rows) {
      const depth = Number(row.depth);
      byDepth.set(depth, [...(byDepth.get(depth) ?? []), row.id]);
    }
    for (const depth of [...byDepth.keys()].toSorted((a, b) => b - a)) {
      // 同一個交易依序：下一層（較淺）要等這一層刪掉才不會違反 parent_id 的外鍵
      // oxlint-disable-next-line no-await-in-loop -- 見上
      await tx
        .delete(fileFolders)
        .where(and(inArray(fileFolders.id, byDepth.get(depth) ?? []), isDeleted(fileFolders)));
    }
    const ids = rows.map((row) => row.id);
    await tx
      .delete(relationTuples)
      .where(
        or(
          and(
            eq(relationTuples.objectType, FOLDER_OBJECT_TYPE),
            inArray(relationTuples.objectId, ids),
          ),
          and(
            eq(relationTuples.subjectType, FOLDER_OBJECT_TYPE),
            inArray(relationTuples.subjectId, ids),
          ),
        ),
      );
    return ids;
  }
}
