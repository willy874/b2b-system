import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import { notifications, users } from '@/db/schema';
import type { NotificationRow } from '@/db/schema';

import type { NotificationCursor } from './notification.cursor';
import type { NotificationInput } from './notification.definition';

/** 列表的一列：通知 ＋ 觸發者的名稱（系統或已被永久刪除時為 null）。 */
export interface NotificationWithActor extends NotificationRow {
  actor: { id: string; name: string } | null;
}

const WITH_ACTOR_COLUMNS = {
  notification: notifications,
  actorId: users.id,
  actorName: users.displayName,
  // 游標用：微秒精度（JS 的 Date 只有毫秒）
  createdAtExact: sql<string>`to_char(${notifications.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
} as const;

function toWithActor(row: {
  notification: NotificationRow;
  actorId: string | null;
  actorName: string | null;
}): NotificationWithActor {
  return {
    ...row.notification,
    actor: row.actorId && row.actorName ? { id: row.actorId, name: row.actorName } : null,
  };
}

const ownedBy = (recipientId: string) => eq(notifications.recipientId, recipientId);

/** 總覽的一列：再加上收件人的名稱。 */
export interface NotificationWithRecipient extends NotificationWithActor {
  recipient: { id: string; name: string };
}

/** 總覽的篩選（docs/architecture/backend/19-announcement.md §9.2 D1）。 */
export interface NotificationOverviewFilter {
  type?: string;
  recipientId?: string;
  actorId?: string;
  unread: boolean;
  from?: Date;
  to?: Date;
}

const recipient = alias(users, 'recipient');

/** 排在游標那一筆之後（`ORDER BY created_at DESC, id DESC`）。 */
const after = (cursor: NotificationCursor) =>
  sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`;

@Injectable()
export class NotificationRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /**
   * 一次 INSERT 寫完所有收件人（在呼叫端的業務交易內）。同一個來源（`source_id`）對同一個人已經有一筆時略過
   * （公告分批寫入的重做，docs/architecture/backend/19-announcement.md §9.2 D9）；回傳的只有這次真的寫入的列。
   */
  async insertMany(
    rows: readonly NotificationInput[],
    tx: DbOrTx,
  ): Promise<Array<{ id: string; recipientId: string }>> {
    if (rows.length === 0) return [];
    return tx
      .insert(notifications)
      .values(
        rows.map((row) => ({
          recipientId: row.recipientId,
          type: row.type,
          params: row.params,
          link: row.link,
          actorId: row.actorId,
          sourceId: row.sourceId ?? null,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: notifications.id, recipientId: notifications.recipientId });
  }

  /**
   * 某人的通知，新的在前；`after` 是上一頁最後一筆（keyset）。`lastCreatedAt` 是這一頁最後一筆的微秒精度時間。
   * `(created_at, id) < (…)` 的列比較與 `ORDER BY created_at DESC, id DESC` 都由 `(recipient_id, created_at, id)` 索引反向掃描取得。
   */
  async list(
    recipientId: string,
    options: { unread: boolean; limit: number; after?: NotificationCursor },
  ): Promise<{ items: NotificationWithActor[]; lastCreatedAt: string | undefined }> {
    const conditions: SQL[] = [ownedBy(recipientId)];
    if (options.unread) conditions.push(isNull(notifications.readAt));
    if (options.after) conditions.push(after(options.after));
    const rows = await this.db
      .select(WITH_ACTOR_COLUMNS)
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.actorId))
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(options.limit);
    return { items: rows.map(toWithActor), lastCreatedAt: rows.at(-1)?.createdAtExact };
  }

  /**
   * 租戶內所有人的通知（總覽），新的在前；分頁同 `list()`。不分收件人時由 `(created_at, id)`、
   * 依類型篩選時由 `(type, created_at, id)` 反向掃描；依收件人篩選時走 `(recipient_id, created_at, id)`。
   */
  async listAll(
    filter: NotificationOverviewFilter,
    options: { limit: number; after?: NotificationCursor },
  ): Promise<{ items: NotificationWithRecipient[]; lastCreatedAt: string | undefined }> {
    const conditions: SQL[] = [];
    if (filter.type) conditions.push(eq(notifications.type, filter.type));
    if (filter.recipientId) conditions.push(ownedBy(filter.recipientId));
    if (filter.actorId) conditions.push(eq(notifications.actorId, filter.actorId));
    if (filter.unread) conditions.push(isNull(notifications.readAt));
    if (filter.from) conditions.push(gte(notifications.createdAt, filter.from));
    if (filter.to) conditions.push(lte(notifications.createdAt, filter.to));
    if (options.after) conditions.push(after(options.after));
    const rows = await this.db
      .select({ ...WITH_ACTOR_COLUMNS, recipientName: recipient.displayName })
      .from(notifications)
      .innerJoin(recipient, eq(recipient.id, notifications.recipientId))
      .leftJoin(users, eq(users.id, notifications.actorId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(options.limit);
    return {
      items: rows.map((row) => ({
        ...toWithActor(row),
        recipient: { id: row.notification.recipientId, name: row.recipientName },
      })),
      lastCreatedAt: rows.at(-1)?.createdAtExact,
    };
  }

  // ── 來源（公告的發送紀錄，docs/architecture/backend/19-announcement.md §9.2 D4） ──────────────────

  /** 每個來源的通知數與已讀數（發送紀錄的列表）；沒有通知的來源不在結果裡。 */
  async countBySources(
    sourceIds: readonly string[],
  ): Promise<Array<{ sourceId: string; total: number; read: number }>> {
    if (sourceIds.length === 0) return [];
    const rows = await this.db
      .select({
        sourceId: notifications.sourceId,
        total: count(),
        read: count(notifications.readAt),
      })
      .from(notifications)
      .where(inArray(notifications.sourceId, [...sourceIds]))
      .groupBy(notifications.sourceId);
    return rows.flatMap((row) => (row.sourceId ? [{ ...row, sourceId: row.sourceId }] : []));
  }

  /** 某人收到的、來自這個來源的通知標為已讀（已讀過的保留時間）；回傳那則通知的 id，沒有收到回 undefined。 */
  async markSourceRead(
    sourceId: string,
    recipientId: string,
    now: Date,
  ): Promise<{ id: string; wasUnread: boolean } | undefined> {
    const [row] = await this.db
      .select({ id: notifications.id, readAt: notifications.readAt })
      .from(notifications)
      .where(and(eq(notifications.sourceId, sourceId), ownedBy(recipientId)))
      .limit(1);
    if (!row) return undefined;
    if (!row.readAt) {
      await this.db
        .update(notifications)
        .set({ readAt: now })
        .where(and(eq(notifications.id, row.id), isNull(notifications.readAt)));
    }
    return { id: row.id, wasUnread: !row.readAt };
  }

  /** 刪除一批來自這個來源的通知（撤回），回傳刪掉的列；少於 `limit` 代表刪完了。 */
  async deleteBySource(
    sourceId: string,
    limit: number,
  ): Promise<Array<{ id: string; recipientId: string }>> {
    const batch = this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.sourceId, sourceId))
      .limit(limit);
    return this.db
      .delete(notifications)
      .where(inArray(notifications.id, batch))
      .returning({ id: notifications.id, recipientId: notifications.recipientId });
  }

  /** 自己的一則通知；別人的與不存在的一樣回 undefined。 */
  async findOwn(id: string, recipientId: string): Promise<NotificationWithActor | undefined> {
    const [row] = await this.db
      .select(WITH_ACTOR_COLUMNS)
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.actorId))
      .where(and(eq(notifications.id, id), ownedBy(recipientId)))
      .limit(1);
    return row && toWithActor(row);
  }

  async countUnread(recipientId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(notifications)
      .where(and(ownedBy(recipientId), isNull(notifications.readAt)));
    return row?.total ?? 0;
  }

  /** 標為已讀；已經讀過的保留原本的時間。別人的與不存在的回 false。 */
  async markRead(id: string, recipientId: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, ${now.toISOString()}::timestamptz)` })
      .where(and(eq(notifications.id, id), ownedBy(recipientId)))
      .returning({ id: notifications.id });
    return rows.length > 0;
  }

  /** 刪除某人自己的一則；不是他的或不存在回 false。 */
  async deleteOwn(id: string, recipientId: string): Promise<boolean> {
    const rows = await this.db
      .delete(notifications)
      .where(and(eq(notifications.id, id), ownedBy(recipientId)))
      .returning({ id: notifications.id });
    return rows.length > 0;
  }

  /** 某人所有未讀的通知標為已讀，回傳筆數。 */
  async markAllRead(recipientId: string, now: Date): Promise<number> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: now })
      .where(and(ownedBy(recipientId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return rows.length;
  }

  /** 刪除一批「早於 `cutoff` 就已讀」的通知，回傳筆數；少於 `limit` 代表清完了。 */
  async deleteReadBefore(cutoff: Date, limit: number): Promise<number> {
    const expired = this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(lt(notifications.readAt, cutoff))
      .limit(limit);
    const rows = await this.db
      .delete(notifications)
      .where(inArray(notifications.id, expired))
      .returning({ id: notifications.id });
    return rows.length;
  }

  /**
   * 刪除一批「不在每人最新 `keep` 則內」的通知（不論已讀與否），回傳筆數；少於 `limit` 代表清完了。
   * 排名與列表同一個順序（`created_at DESC, id DESC`），被刪的一定是列表最後面的。
   */
  async deleteBeyondPerRecipient(keep: number, limit: number): Promise<number> {
    const ranked = this.db
      .select({
        id: notifications.id,
        rank: sql<number>`row_number() OVER (PARTITION BY ${notifications.recipientId} ORDER BY ${notifications.createdAt} DESC, ${notifications.id} DESC)`.as(
          'rank',
        ),
      })
      .from(notifications)
      .as('ranked');
    const beyond = this.db
      .select({ id: ranked.id })
      .from(ranked)
      .where(sql`${ranked.rank} > ${keep}`)
      .limit(limit);
    const rows = await this.db
      .delete(notifications)
      .where(inArray(notifications.id, beyond))
      .returning({ id: notifications.id });
    return rows.length;
  }
}
