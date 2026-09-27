import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNull, like, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { FileInsert, FileRow } from '@/db/schema';
import { files, users } from '@/db/schema';

import type { ListFileDto } from './dto/list-file.dto';

export interface FileWithUploader extends FileRow {
  uploader: { id: string; displayName: string } | null;
}

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
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

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
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .limit(1);
    return row && FileRepository.toFileWithUploader(row);
  }

  /** 只列出 `ready` 的檔案；`pending` 是還沒完成的上傳，不出現在列表。 */
  async list(query: ListFileDto): Promise<{ items: FileWithUploader[]; total: number }> {
    const conditions: SQL[] = [isNull(files.deletedAt), eq(files.status, 'ready')];
    if (query.keyword) conditions.push(ilike(files.name, `%${escapeLike(query.keyword)}%`));
    if (query.contentType) {
      conditions.push(
        query.contentType.endsWith('/*')
          ? like(files.contentType, `${escapeLike(query.contentType.slice(0, -1))}%`)
          : eq(files.contentType, query.contentType),
      );
    }
    const where = and(...conditions);
    // 最後以 id 收尾，讓同值的列在分頁之間順序穩定
    const orderBy = query.sort.map(({ sort, order }) =>
      order === 'asc' ? asc(SORT_COLUMNS[sort]) : desc(SORT_COLUMNS[sort]),
    );

    const [rows, [counted]] = await Promise.all([
      this.selectWithUploader()
        .where(where)
        .orderBy(...orderBy, desc(files.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(files)
        .where(where),
    ]);
    return { items: rows.map(FileRepository.toFileWithUploader), total: counted?.total ?? 0 };
  }

  async create(values: FileInsert, tx?: DbOrTx): Promise<FileRow> {
    const db = tx ?? this.db;
    const [row] = await db.insert(files).values(values).returning();
    if (!row) throw new Error('建立檔案紀錄失敗');
    return row;
  }

  /** 只有 `pending` 會被改成 `ready`；並行的第二次完成請求拿到 undefined。 */
  async markReady(
    id: string,
    values: { size: number; etag: string; uploadedAt: Date; updatedBy: string },
    tx?: DbOrTx,
  ): Promise<FileRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(files)
      .set({ ...values, status: 'ready' })
      .where(and(eq(files.id, id), eq(files.status, 'pending'), isNull(files.deletedAt)))
      .returning();
    return row;
  }

  async update(
    id: string,
    values: Pick<FileInsert, 'name' | 'updatedBy'>,
    tx?: DbOrTx,
  ): Promise<FileRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(files)
      .set(values)
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .returning();
    return row;
  }

  async softDelete(id: string, actorId: string, tx?: DbOrTx): Promise<FileRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(files)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(files.id, id), isNull(files.deletedAt)))
      .returning();
    return row;
  }
}
