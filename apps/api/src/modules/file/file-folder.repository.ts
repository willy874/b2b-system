import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { FileFolderInsert, FileFolderRow } from '@/db/schema';
import { fileFolders, files } from '@/db/schema';

/**
 * 資料夾結構的寫入以交易層級的 advisory lock 排隊（docs/architecture/backend/09-file.md §4.2）：
 * 兩個人同時把 A 移進 B、把 B 移進 A，各自檢查時都看不到循環，排隊之後第二個就看得到。
 * 資料夾的寫入不頻繁，整棵樹共用一把鎖就夠了。
 */
const FOLDER_TREE_LOCK_KEY = 'file_folders_tree';

@Injectable()
export class FileFolderRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** 取得資料夾結構的寫入鎖；交易結束時自動釋放。 */
  async lockTree(tx: DbOrTx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${FOLDER_TREE_LOCK_KEY}))`);
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

  async softDelete(ids: readonly string[], actorId: string, tx?: DbOrTx): Promise<number> {
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
