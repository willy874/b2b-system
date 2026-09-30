import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

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

@Injectable()
export class NotificationRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 一次 INSERT 寫完所有收件人（在呼叫端的業務交易內）。 */
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
        })),
      )
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
    if (options.after) {
      conditions.push(
        sql`(${notifications.createdAt}, ${notifications.id}) < (${options.after.createdAt}::timestamptz, ${options.after.id}::uuid)`,
      );
    }
    const rows = await this.db
      .select(WITH_ACTOR_COLUMNS)
      .from(notifications)
      .leftJoin(users, eq(users.id, notifications.actorId))
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(options.limit);
    return { items: rows.map(toWithActor), lastCreatedAt: rows.at(-1)?.createdAtExact };
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
