import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { anyUuid, containsPattern, TENANT_DB } from '@/core/database';
import type { TimeIdCursor } from '@/core/http';
import { comments, notDeleted, users } from '@/db/schema';
import type { CommentInsert, CommentRow } from '@/db/schema';

/** 留言列表的一列：帶作者與資料庫格式化的微秒時間（游標用）。 */
export interface CommentWithAuthor {
  comment: CommentRow;
  author: { id: string; displayName: string; email: string } | null;
  /** 作者的頭像（圖片資產 id，docs/architecture/backend/25-image.md §15.8）；沒有設定是 null。 */
  authorAvatarImageId: string | null;
  createdAtExact: string;
}

/** 留言裡出現的人。 */
export interface CommentUser {
  id: string;
  displayName: string;
  email: string;
}

const author = aliasedTable(users, 'author');

const after = (cursor: TimeIdCursor) =>
  sql`(${comments.createdAt}, ${comments.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;

/** 可以被 @提及的人：未刪除、`active` 的一般使用者（服務帳號不會看留言）。 */
const mentionable: SQL[] = [notDeleted(users), eq(users.status, 'active'), eq(users.kind, 'human')];

/** 留言（docs/architecture/backend/24-comment.md §2）。 */
@Injectable()
export class CommentRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 一個資源的留言，新的在前；由 `comments_resource_created_idx` 反向掃描。 */
  async list(
    resourceType: string,
    resourceId: string,
    options: { limit: number; after?: TimeIdCursor },
  ): Promise<CommentWithAuthor[]> {
    const conditions = [
      eq(comments.resourceType, resourceType),
      eq(comments.resourceId, resourceId),
      ...(options.after ? [after(options.after)] : []),
    ];
    const rows = await this.db
      .select({
        comment: comments,
        authorId: author.id,
        authorName: author.displayName,
        authorEmail: author.email,
        authorAvatarImageId: author.avatarImageId,
        createdAtExact: sql<string>`to_char(${comments.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(comments)
      .leftJoin(author, eq(author.id, comments.authorId))
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(options.limit);
    return rows.map((row) => ({
      comment: row.comment,
      author:
        row.authorId === null
          ? null
          : { id: row.authorId, displayName: row.authorName ?? '', email: row.authorEmail ?? '' },
      authorAvatarImageId: row.authorAvatarImageId,
      createdAtExact: row.createdAtExact,
    }));
  }

  async findById(id: string, tx?: DbOrTx): Promise<CommentRow | undefined> {
    const [row] = await (tx ?? this.db).select().from(comments).where(eq(comments.id, id));
    return row;
  }

  async create(values: CommentInsert, tx: DbOrTx): Promise<CommentRow> {
    const [row] = await tx.insert(comments).values(values).returning();
    if (!row) throw new Error('comments 寫入沒有回傳列');
    return row;
  }

  /** 條件式 UPDATE（樂觀鎖）：版本不符或列已不在回 `undefined`。 */
  async update(
    id: string,
    values: Pick<CommentInsert, 'body' | 'mentions'>,
    expectedVersion: number,
    tx: DbOrTx,
  ): Promise<CommentRow | undefined> {
    const [row] = await tx
      .update(comments)
      .set({ ...values, version: sql`${comments.version} + 1`, editedAt: new Date() })
      .where(and(eq(comments.id, id), eq(comments.version, expectedVersion)))
      .returning();
    return row;
  }

  async findVersion(id: string, tx: DbOrTx): Promise<number | undefined> {
    const [row] = await tx
      .select({ version: comments.version })
      .from(comments)
      .where(eq(comments.id, id))
      .limit(1);
    return row?.version;
  }

  /** 硬刪除（D5）；不存在回 false。 */
  async delete(id: string, tx: DbOrTx): Promise<boolean> {
    const rows = await tx
      .delete(comments)
      .where(eq(comments.id, id))
      .returning({ id: comments.id });
    return rows.length > 0;
  }

  /** 資源永久刪除時清掉它們的留言（D10）。 */
  async removeAllFor(
    resourceType: string,
    resourceIds: readonly string[],
    tx: DbOrTx,
  ): Promise<void> {
    if (!resourceIds.length) return;
    await tx
      .delete(comments)
      .where(
        and(eq(comments.resourceType, resourceType), anyUuid(comments.resourceId, resourceIds)),
      );
  }

  // ── 人 ───────────────────────────────────────────────

  /** 這些人（顯示被提及的人）：被永久刪除的不在結果裡；軟刪除與停用的照常顯示名稱。 */
  usersByIds(ids: readonly string[]): Promise<CommentUser[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: sql<string>`${users.email}::text`,
      })
      .from(users)
      .where(anyUuid(users.id, ids));
  }

  /** 這些人之中可以被 @提及的（未刪除、active 的一般使用者）。 */
  async findMentionable(ids: readonly string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, [...ids]), ...mentionable));
    return rows.map((row) => row.id);
  }

  /** 一個人的頭像（寫入之後回傳的那一筆：作者是自己）。 */
  async avatarImageIdOf(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ avatarImageId: users.avatarImageId })
      .from(users)
      .where(eq(users.id, userId));
    return row?.avatarImageId ?? null;
  }

  /** @提及的候選：顯示名稱或 email 包含 `keyword`，依顯示名稱排序。 */
  searchMentionable(keyword: string, limit: number): Promise<CommentUser[]> {
    const pattern = containsPattern(keyword);
    return this.db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: sql<string>`${users.email}::text`,
      })
      .from(users)
      .where(
        and(
          ...mentionable,
          keyword
            ? or(ilike(users.displayName, pattern), ilike(sql`${users.email}::text`, pattern))
            : undefined,
        ),
      )
      .orderBy(asc(users.displayName), asc(users.id))
      .limit(limit);
  }
}
