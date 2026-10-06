import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  like,
  isNotNull,
  lt,
  not,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database, DbOrTx } from '@/core/database';
import { containsPattern, TENANT_DB } from '@/core/database';
import { RESOURCE_TYPE } from '@/core/resource';
import type { FileInsert, FileRow, FileVariantStatus } from '@/db/schema';
import {
  fileFolders,
  files,
  fileStorageUsage,
  hasAnyTag,
  isDeleted,
  notDeleted,
  relationTuples,
  users,
} from '@/db/schema';

import type { ListFileDto } from './dto/list-file.dto';
import { FILE_CATEGORY_RULES } from './file.constants';
import type { FileCategory } from './file.constants';
import type { FileCursor } from './file.cursor';

export interface FileWithUploader extends FileRow {
  uploader: { id: string; displayName: string } | null;
}

/** 回收桶的一列（`listDeleted`）；刪除者取自刪除時寫入的 `updated_by`（刪除之後不再有人更新這一列）。 */
export interface DeletedFileRow {
  id: string;
  name: string;
  folderId: string | null;
  deletedAt: Date;
  deletedBy: { id: string; name: string } | null;
}

/** 刪除者：`users` 的別名。 */
const deleter = alias(users, 'deleter');

/**
 * 個別刪除的檔案：所在的資料夾不是 **同一次刪除** 刪掉的（docs/architecture/backend/14-revisions.md §9.2 D5）。跟著資料夾一起刪除的檔案屬於那個資料夾的批次，
 * 在回收桶只列資料夾，還原資料夾時一起回來。R4a 之前刪除的列 `deletion_id` 是 null，以 `IS NOT DISTINCT FROM`
 * 比對：舊的遞迴刪除（資料夾與檔案都是 null）同樣視為同一批。
 */
const DELETED_ON_ITS_OWN = sql`NOT EXISTS (
  SELECT 1 FROM ${fileFolders} AS container
  WHERE container.id = ${files.folderId}
    AND container.deleted_at IS NOT NULL
    AND container.deletion_id IS NOT DISTINCT FROM ${files.deletionId}
)`;

/** 關係圖上檔案的物件型別（file.authz.ts 的 `FILE_TYPE`）。 */
const FILE_OBJECT_TYPE = 'file';

const SORT_COLUMNS = {
  createdAt: files.createdAt,
  name: files.name,
  size: files.size,
} as const;

/** LIKE 的萬用字元當成一般字元比對。 */
function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class FileRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  private selectWithUploader() {
    return this.db
      .select({
        file: files,
        uploaderId: users.id,
        uploaderName: users.displayName,
      })
      .from(files)
      .leftJoin(users, eq(users.id, files.createdBy));
  }

  private static toFileWithUploader(row: {
    file: FileRow;
    uploaderId: string | null;
    uploaderName: string | null;
  }): FileWithUploader {
    return {
      ...row.file,
      uploader:
        row.uploaderId === null || row.uploaderName === null
          ? null
          : { id: row.uploaderId, displayName: row.uploaderName },
    };
  }

  /** 未刪除的檔案（含 pending）。 */
  async findById(id: string): Promise<FileWithUploader | undefined> {
    const [row] = await this.selectWithUploader()
      .where(and(eq(files.id, id), notDeleted(files)))
      .limit(1);
    return row && FileRepository.toFileWithUploader(row);
  }

  /**
   * 只列出 `ready` 的檔案；`pending` 是還沒完成的上傳，不出現在列表。
   * 有 `after`（keyset 游標）時忽略 offset，只依 `sort[0]` ＋ id 排序，取「排在游標之後」的一頁。
   * `lastCreatedAt` 是最後一筆的 `created_at`（微秒精度），給下一頁的游標用。
   * `scope.folderIds`：只列這些資料夾裡的檔案（根目錄不含在內）；不帶則不限（資料夾層級授權的範圍）。
   */
  async list(
    query: ListFileDto,
    after?: FileCursor,
    scope?: { folderIds: readonly string[] },
  ): Promise<{
    items: FileWithUploader[];
    total: number | null;
    lastCreatedAt: string | undefined;
  }> {
    if (scope?.folderIds.length === 0) {
      return { items: [], total: after ? null : 0, lastCreatedAt: undefined };
    }
    const conditions: SQL[] = [notDeleted(files), eq(files.status, 'ready')];
    if (scope) conditions.push(inArray(files.folderId, [...scope.folderIds]));
    if (query.keyword) conditions.push(ilike(files.name, `%${escapeLike(query.keyword)}%`));
    if (query.contentType) {
      conditions.push(
        query.contentType.endsWith('/*')
          ? like(files.contentType, `${escapeLike(query.contentType.slice(0, -1))}%`)
          : eq(files.contentType, query.contentType),
      );
    }
    if (query.category) conditions.push(categoryCondition(query.category));
    if (query.folderId) {
      conditions.push(
        query.folderId === 'root' ? isNull(files.folderId) : eq(files.folderId, query.folderId),
      );
    }
    if (query.uploaderId) conditions.push(eq(files.createdBy, query.uploaderId));
    if (query.tagId?.length) conditions.push(hasAnyTag(RESOURCE_TYPE.FILE, files.id, query.tagId));
    const where = and(...conditions);

    const sorts = after ? [after.sort] : query.sort;
    // 最後以 id 收尾，讓同值的列在分頁之間順序穩定
    const orderBy = sorts.map(({ sort, order }) =>
      order === 'asc' ? asc(SORT_COLUMNS[sort]) : desc(SORT_COLUMNS[sort]),
    );
    const pageWhere = after ? and(where, afterCursor(after)) : where;

    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          file: files,
          uploaderId: users.id,
          uploaderName: users.displayName,
          createdAtExact: sql<string>`to_char(${files.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(files)
        .leftJoin(users, eq(users.id, files.createdBy))
        .where(pageWhere)
        .orderBy(...orderBy, desc(files.id))
        .limit(query.limit)
        .offset(after ? 0 : query.offset),
      // 帶游標的頁（無限捲動往下捲）不重算總數：前端只用第一頁的 total
      after
        ? Promise.resolve([])
        : this.db
            .select({ total: sql<number>`count(*)::int` })
            .from(files)
            .where(where),
    ]);
    return {
      items: rows.map(FileRepository.toFileWithUploader),
      total: after ? null : (counted?.total ?? 0),
      lastCreatedAt: rows.at(-1)?.createdAtExact,
    };
  }

  // ── 已用量（docs/architecture/05-tenancy.md §13.3 D8、docs/architecture/backend/09-file.md §5.0） ──
  // `file_storage_usage` 是 `files.size` 合計的計數（含上傳中與回收桶裡的）：登記（create）、完成（markReady 大小有差時）、
  // 永久刪除（hardDelete）在同一個交易內增減；軟刪除與還原不動它。`file.maintenance` 每天以 SUM(size) 對帳。

  /** 已用量，位元組：讀計數那一列，O(1)，不加總整張 `files`。 */
  async storageUsed(tx?: DbOrTx): Promise<number> {
    const [row] = await (tx ?? this.db)
      .select({ usedBytes: fileStorageUsage.usedBytes })
      .from(fileStorageUsage)
      .limit(1);
    return row?.usedBytes ?? 0;
  }

  /**
   * 在容量內登記一筆檔案（在呼叫端的交易內）：先以一條條件式 UPDATE 把 `size` 加進已用量
   * （加上之後不超過 `quota` 才更新）再 INSERT。檢查與佔用是同一條語句，同時的登記以計數那一列的列鎖排隊。
   * 超過容量回 undefined，什麼都不寫。
   */
  async create(values: FileInsert, quota: number, tx: DbOrTx): Promise<FileRow | undefined> {
    const [reserved] = await tx
      .update(fileStorageUsage)
      .set({ usedBytes: sql`${fileStorageUsage.usedBytes} + ${values.size}` })
      .where(
        and(
          eq(fileStorageUsage.id, true),
          sql`${fileStorageUsage.usedBytes} + ${values.size} <= ${quota}`,
        ),
      )
      .returning({ usedBytes: fileStorageUsage.usedBytes });
    if (!reserved) return undefined;
    const [row] = await tx.insert(files).values(values).returning();
    if (!row) throw new Error('建立檔案紀錄失敗');
    return row;
  }

  /**
   * 只有 `pending` 會被改成 `ready`；並行的第二次完成請求拿到 undefined。
   * 實際大小與登記的不同時，已用量在同一個交易內補上差額（先鎖住這一列讀登記的大小，差額只補一次）。
   */
  async markReady(
    id: string,
    values: {
      size: number;
      etag: string;
      uploadedAt: Date;
      hasThumbnail: boolean;
      variantStatus: FileVariantStatus;
      updatedBy: string;
    },
    tx: DbOrTx,
  ): Promise<FileRow | undefined> {
    const pending = and(eq(files.id, id), eq(files.status, 'pending'), notDeleted(files));
    const [registered] = await tx
      .select({ size: files.size })
      .from(files)
      .where(pending)
      .for('update');
    if (!registered) return undefined;
    const [row] = await tx
      .update(files)
      .set({ ...values, status: 'ready', uploadId: null })
      .where(pending)
      .returning();
    if (row && row.size !== registered.size) {
      await this.addStorageUsed(row.size - registered.size, tx);
    }
    return row;
  }

  /**
   * 改名並遞增版本。只在版本相符才更新（比對與寫入在同一個 UPDATE，
   * 不會有「讀到舊版本後別人搶先寫入」的空窗）；不符回 undefined。
   */
  async update(
    id: string,
    values: Pick<FileInsert, 'name' | 'updatedBy'>,
    expectedVersion: number,
    tx?: DbOrTx,
  ): Promise<FileRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(files)
      .set({ ...values, version: sql`${files.version} + 1` })
      .where(and(eq(files.id, id), notDeleted(files), eq(files.version, expectedVersion)))
      .returning();
    return row;
  }

  /** 未刪除的檔案目前的 `version`；不存在或已刪除回 undefined（改名的樂觀鎖衝突時重讀）。 */
  async findVersion(id: string, tx?: DbOrTx): Promise<number | undefined> {
    const [row] = await (tx ?? this.db)
      .select({ version: files.version })
      .from(files)
      .where(and(eq(files.id, id), notDeleted(files)))
      .limit(1);
    return row?.version;
  }

  /**
   * 放棄上傳：只作用在 `pending`，已完成的上傳不受影響。
   * `actorId` 為 null 是維護排程清掉的逾時上傳。
   */
  async discardPending(
    id: string,
    actorId: string | null,
    tx?: DbOrTx,
  ): Promise<FileRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(files)
      // 放棄的上傳從未對其他人可見，不進回收桶（列表只列 ready），仍照規則帶自己的 deletion_id
      .set({ deletedAt: new Date(), updatedBy: actorId, deletionId: randomUUID() })
      .where(and(eq(files.id, id), eq(files.status, 'pending'), notDeleted(files)))
      .returning();
    return row;
  }

  /** 影像變體產生完成。只作用在還在等待的檔案：途中被刪除的回 undefined。 */
  async markVariantsReady(
    id: string,
    values: { imageWidth: number; imageHeight: number; variantFormat: string },
  ): Promise<FileRow | undefined> {
    const [row] = await this.db
      .update(files)
      .set({ ...values, variantStatus: 'ready' })
      .where(and(eq(files.id, id), eq(files.variantStatus, 'pending'), notDeleted(files)))
      .returning();
    return row;
  }

  async markVariantsFailed(id: string): Promise<void> {
    await this.db
      .update(files)
      .set({ variantStatus: 'failed' })
      .where(and(eq(files.id, id), eq(files.variantStatus, 'pending')));
  }

  /** 完成上傳超過一段時間仍在等待產生影像變體的檔案（最早完成的先）。 */
  async findPendingVariants(uploadedBefore: Date, limit: number): Promise<string[]> {
    const rows = await this.db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.variantStatus, 'pending'),
          notDeleted(files),
          lt(files.uploadedAt, uploadedBefore),
        ),
      )
      .orderBy(asc(files.uploadedAt))
      .limit(limit);
    return rows.map((row) => row.id);
  }

  /** 登記早於 `createdBefore` 仍未完成的上傳，依 id 分頁（`afterId` 之後）。 */
  async findStalePending(
    createdBefore: Date,
    afterId: string | undefined,
    limit: number,
  ): Promise<Pick<FileRow, 'id' | 'storageKey' | 'uploadId'>[]> {
    const conditions = [
      eq(files.status, 'pending'),
      notDeleted(files),
      lt(files.createdAt, createdBefore),
    ];
    if (afterId) conditions.push(gt(files.id, afterId));
    return this.db
      .select({ id: files.id, storageKey: files.storageKey, uploadId: files.uploadId })
      .from(files)
      .where(and(...conditions))
      .orderBy(asc(files.id))
      .limit(limit);
  }

  /**
   * 這些 id 之中有紀錄的（含 pending 與 **已軟刪除** 的）。維護排程的孤兒判定（docs/architecture/backend/09-file.md §9）：
   * 已刪除紀錄的物件要留到回收桶的保留期限結束，由 `trash.purge` 在永久刪除後清掉（docs/architecture/backend/14-revisions.md §9.2 D11）。
   */
  async findRecordedIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: files.id })
      .from(files)
      .where(inArray(files.id, [...ids]));
    return new Set(rows.map((row) => row.id));
  }

  /** 這些分塊上傳之中還屬於某個未刪除紀錄的。 */
  async findLiveUploadIds(uploadIds: readonly string[]): Promise<Set<string>> {
    if (uploadIds.length === 0) return new Set();
    const rows = await this.db
      .select({ uploadId: files.uploadId })
      .from(files)
      .where(
        and(inArray(files.uploadId, [...uploadIds]), isNotNull(files.uploadId), notDeleted(files)),
      );
    return new Set(rows.flatMap((row) => (row.uploadId ? [row.uploadId] : [])));
  }

  /** 刪除一個檔案；`deletionId` 是這一次刪除的識別（docs/architecture/backend/14-revisions.md §9.2 D5）。 */
  async softDelete(
    id: string,
    values: { actorId: string; deletionId: string },
    tx?: DbOrTx,
  ): Promise<FileRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(files)
      .set({ deletedAt: new Date(), updatedBy: values.actorId, deletionId: values.deletionId })
      .where(and(eq(files.id, id), notDeleted(files)))
      .returning();
    return row;
  }

  // ── 回收桶與還原（docs/architecture/backend/14-revisions.md §9.2 D5、D9、D11）：這一段故意讀已刪除的列，一律用 isDeleted() ──

  /** 已刪除的檔案（含放棄的上傳）；不存在或沒有被刪除回 undefined。 */
  async findDeletedById(id: string, tx?: DbOrTx): Promise<FileRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(files)
      .where(and(eq(files.id, id), isDeleted(files)))
      .limit(1);
    return row;
  }

  /**
   * 同一次刪除（`deletionId`，null 是 R4a 之前的刪除）、在這些資料夾裡、已完成上傳的檔案：還原資料夾時一起回來的候選。
   * 上傳中被刪掉的（`pending`）不還原：直傳網址早已過期，只能重新上傳。
   */
  async findDeletedInBatch(
    folderIds: readonly string[],
    deletionId: string | null,
    tx?: DbOrTx,
  ): Promise<FileRow[]> {
    if (folderIds.length === 0) return [];
    return (tx ?? this.db)
      .select()
      .from(files)
      .where(
        and(
          inArray(files.folderId, [...folderIds]),
          isDeleted(files),
          eq(files.status, 'ready'),
          sql`${files.deletionId} IS NOT DISTINCT FROM ${deletionId}::uuid`,
        ),
      );
  }

  /**
   * 清掉 `deleted_at` 與 `deletion_id`（只在仍是同一批已刪除、已完成上傳時；並行的兩個還原只有一個命中）。
   * 刪除期間消失的附屬物件另由 `clearThumbnail`、`resetVariants` 修正。
   * `version` 不遞增：與刪除一樣不是可編輯欄位的寫入（docs/architecture/backend/03-api-conventions.md §11）。
   */
  async restore(
    ids: readonly string[],
    values: { actorId: string; deletionId: string | null },
    tx: DbOrTx,
  ): Promise<FileRow[]> {
    if (ids.length === 0) return [];
    return tx
      .update(files)
      .set({ deletedAt: null, deletionId: null, updatedBy: values.actorId })
      .where(
        and(
          inArray(files.id, [...ids]),
          isDeleted(files),
          eq(files.status, 'ready'),
          sql`${files.deletionId} IS NOT DISTINCT FROM ${values.deletionId}::uuid`,
        ),
      )
      .returning();
  }

  /** 還原時發現瀏覽器縮圖已不在：不再發縮圖網址。 */
  async clearThumbnail(ids: readonly string[], tx: DbOrTx): Promise<void> {
    if (ids.length === 0) return;
    await tx
      .update(files)
      .set({ hasThumbnail: false })
      .where(inArray(files.id, [...ids]));
  }

  /** 還原時發現影像變體已不在：回到 `pending`，重新產生（`files_variant_ready_described` 只約束 `ready`）。 */
  async resetVariants(ids: readonly string[], tx: DbOrTx): Promise<void> {
    if (ids.length === 0) return;
    await tx
      .update(files)
      .set({ variantStatus: 'pending', imageWidth: null, imageHeight: null, variantFormat: null })
      .where(inArray(files.id, [...ids]));
  }

  /**
   * 回收桶：個別刪除、已完成上傳的檔案（跟著資料夾一起刪的只列資料夾，`DELETED_ON_ITS_OWN`）。
   * 放棄的上傳（`pending`）從未對其他人可見，不列。
   */
  async listDeleted(query: {
    offset: number;
    limit: number;
    keyword?: string;
  }): Promise<{ items: DeletedFileRow[]; total: number }> {
    const conditions: SQL[] = [isDeleted(files), eq(files.status, 'ready'), DELETED_ON_ITS_OWN];
    if (query.keyword) conditions.push(ilike(files.name, containsPattern(query.keyword)));
    const where = and(...conditions);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: files.id,
          name: files.name,
          folderId: files.folderId,
          deletedAt: files.deletedAt,
          deleterId: deleter.id,
          deleterName: deleter.displayName,
        })
        .from(files)
        .leftJoin(deleter, eq(deleter.id, files.updatedBy))
        .where(where)
        .orderBy(desc(files.deletedAt), desc(files.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(files)
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
   * 刪除超過保留期限的檔案（依 id 的 keyset；docs/architecture/backend/14-revisions.md §9.2 D11）。含放棄的上傳與跟著資料夾一起刪的檔案：
   * 它們都要先清掉，資料夾（`files.folder_id` 是 `RESTRICT`）才刪得掉。
   */
  async findExpired(
    cutoff: Date,
    afterId: string | null,
    limit: number,
  ): Promise<Array<{ id: string; name: string; deletedAt: Date }>> {
    const rows = await this.db
      .select({ id: files.id, name: files.name, deletedAt: files.deletedAt })
      .from(files)
      .where(
        and(
          isDeleted(files),
          lt(files.deletedAt, cutoff),
          afterId ? gt(files.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(files.id))
      .limit(limit);
    return rows.flatMap(({ deletedAt, ...row }) => (deletedAt ? [{ ...row, deletedAt }] : []));
  }

  /**
   * 永久刪除一個已刪除的檔案（在呼叫端的交易內；docs/architecture/backend/13-trash.md §7.3）。沒有任何表以外鍵參照 `files`；
   * 關係圖以它為物件的邊（目前沒有，檔案的結構邊是臨時補上的）照規則一併刪除。物件儲存的內容由 handler 在交易提交後刪除。
   * 回傳是否刪到（已被還原或已不在就是 false）。
   */
  async hardDelete(id: string, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .delete(files)
      .where(and(eq(files.id, id), isDeleted(files)))
      .returning({ id: files.id, size: files.size });
    if (!row) return false;
    // 永久刪除才釋出容量（軟刪除與還原不動已用量）
    await this.addStorageUsed(-row.size, tx);
    await tx
      .delete(relationTuples)
      .where(and(eq(relationTuples.objectType, FILE_OBJECT_TYPE), eq(relationTuples.objectId, id)));
    return true;
  }

  /** 已用量加上 `delta`（可為負）。不低於 0：計數有偏差時等對帳修正，不讓永久刪除因此失敗。 */
  private async addStorageUsed(delta: number, tx: DbOrTx): Promise<void> {
    await tx
      .update(fileStorageUsage)
      .set({ usedBytes: sql`greatest(${fileStorageUsage.usedBytes} + ${delta}, 0)` })
      .where(eq(fileStorageUsage.id, true));
  }

  /**
   * 對帳的第一步：鎖住計數那一列（在呼叫端的交易內）。登記、完成、永久刪除都在自己的交易內更新它，
   * 鎖住之後的新語句（`sumSizes`）看得到所有已提交的變更，還沒提交的會排在對帳之後才加減。
   * 那一列不存在（例：被人為刪掉）回 undefined。
   */
  async lockStorageUsage(
    tx: DbOrTx,
  ): Promise<{ usedBytes: number; reconciledAt: Date | null } | undefined> {
    const [row] = await tx
      .select({
        usedBytes: fileStorageUsage.usedBytes,
        reconciledAt: fileStorageUsage.reconciledAt,
      })
      .from(fileStorageUsage)
      .where(eq(fileStorageUsage.id, true))
      .for('update');
    return row;
  }

  /** 所有檔案（含上傳中與回收桶裡的）的大小合計，位元組。會掃過整張 `files`：只給每天的對帳用。 */
  async sumSizes(tx: DbOrTx): Promise<number> {
    const [row] = await tx
      .select({ used: sql<string>`coalesce(sum(${files.size}), 0)::text` })
      .from(files);
    return Number(row?.used ?? 0);
  }

  /** 寫回對帳的結果；那一列不存在時補上。 */
  async setStorageUsage(usedBytes: number, reconciledAt: Date, tx: DbOrTx): Promise<void> {
    await tx
      .insert(fileStorageUsage)
      .values({ id: true, usedBytes, reconciledAt })
      .onConflictDoUpdate({ target: fileStorageUsage.id, set: { usedBytes, reconciledAt } });
  }
}

/** 分類 → content_type 條件；`other` 是「不屬於任何一類」。 */
function categoryCondition(category: FileCategory): SQL {
  if (category !== 'other') return ruleCondition(FILE_CATEGORY_RULES[category]);
  const any = or(...Object.values(FILE_CATEGORY_RULES).map(ruleCondition));
  return any ? not(any) : sql`true`;
}

function ruleCondition(rule: { prefixes: readonly string[]; types: readonly string[] }): SQL {
  const parts: SQL[] = rule.prefixes.map((prefix) =>
    like(files.contentType, `${escapeLike(prefix)}%`),
  );
  if (rule.types.length > 0) parts.push(inArray(files.contentType, [...rule.types]));
  return or(...parts) ?? sql`false`;
}

/**
 * keyset：「排在游標那一筆之後」。id 一律降冪收尾（與 `orderBy` 相同），
 * 所以條件是 `col <op> v OR (col = v AND id < cursorId)`，`<op>` 依主排序的方向。
 */
function afterCursor(cursor: FileCursor): SQL | undefined {
  const column = SORT_COLUMNS[cursor.sort.sort];
  const value = cursor.sort.sort === 'createdAt' ? sql`${cursor.value}::timestamptz` : cursor.value;
  const beyond = cursor.sort.order === 'asc' ? gt(column, value) : lt(column, value);
  return or(beyond, and(eq(column, value), lt(files.id, cursor.id)));
}
