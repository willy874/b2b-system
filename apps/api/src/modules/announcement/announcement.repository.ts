import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database, DbOrTx } from '@/core/database';
import { containsPattern, TENANT_DB } from '@/core/database';
import type {
  AnnouncementDispatchInsert,
  AnnouncementDispatchRow,
  AnnouncementInsert,
  AnnouncementRow,
} from '@/db/schema';
import {
  announcementDispatches,
  announcements,
  groups,
  isActiveAnnouncement,
  isDeleted,
  isHumanUser,
  notDeleted,
  roles,
  users,
} from '@/db/schema';

import type { ListAnnouncementDto } from './dto/announcement.dto';

type Person = { id: string; displayName: string } | null;

export interface AnnouncementWithPeople extends AnnouncementRow {
  creator: Person;
  updater: Person;
}

export interface DispatchWithPeople extends AnnouncementDispatchRow {
  creator: Person;
  revoker: Person;
}

/** 回收桶的一列；刪除者取自刪除時寫入的 `updated_by`（與群組相同）。 */
export interface DeletedAnnouncementRow {
  id: string;
  title: string;
  status: AnnouncementRow['status'];
  deletedAt: Date;
  deletedBy: { id: string; name: string } | null;
}

/** 一段最多幾個 id（`filterRecipients`）。 */
const RECIPIENT_FILTER_CHUNK = 5000;

const creator = alias(users, 'creator');
const updater = alias(users, 'updater');
const revoker = alias(users, 'revoker');

function person(id: string | null, name: string | null): Person {
  return id && name ? { id, displayName: name } : null;
}

const WITH_PEOPLE = {
  announcement: announcements,
  creatorId: creator.id,
  creatorName: creator.displayName,
  updaterId: updater.id,
  updaterName: updater.displayName,
} as const;

function toWithPeople(row: {
  announcement: AnnouncementRow;
  creatorId: string | null;
  creatorName: string | null;
  updaterId: string | null;
  updaterName: string | null;
}): AnnouncementWithPeople {
  return {
    ...row.announcement,
    creator: person(row.creatorId, row.creatorName),
    updater: person(row.updaterId, row.updaterName),
  };
}

@Injectable()
export class AnnouncementRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  // ── 公告 ─────────────────────────────────────────────

  async list(
    query: ListAnnouncementDto,
  ): Promise<{ items: AnnouncementWithPeople[]; total: number }> {
    const conditions: SQL[] = [isActiveAnnouncement()];
    if (query.status) conditions.push(eq(announcements.status, query.status));
    if (query.keyword) {
      const pattern = containsPattern(query.keyword);
      const matched = or(ilike(announcements.title, pattern), ilike(announcements.body, pattern));
      if (matched) conditions.push(matched);
    }
    const where = and(...conditions);
    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select(WITH_PEOPLE)
        .from(announcements)
        .leftJoin(creator, eq(creator.id, announcements.createdBy))
        .leftJoin(updater, eq(updater.id, announcements.updatedBy))
        .where(where)
        .orderBy(desc(announcements.createdAt), desc(announcements.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db.select({ total: count() }).from(announcements).where(where),
    ]);
    return { items: rows.map(toWithPeople), total: totalRow?.total ?? 0 };
  }

  async findWithPeople(id: string): Promise<AnnouncementWithPeople | undefined> {
    const [row] = await this.db
      .select(WITH_PEOPLE)
      .from(announcements)
      .leftJoin(creator, eq(creator.id, announcements.createdBy))
      .leftJoin(updater, eq(updater.id, announcements.updatedBy))
      .where(and(eq(announcements.id, id), isActiveAnnouncement()))
      .limit(1);
    return row && toWithPeople(row);
  }

  async findActive(id: string, tx?: DbOrTx): Promise<AnnouncementRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), isActiveAnnouncement()))
      .limit(1);
    return row;
  }

  /** 鎖住未刪除的一列（交易內的狀態轉換、排程的發送）；不存在或已刪除回 undefined。 */
  async lockActive(id: string, tx: DbOrTx): Promise<AnnouncementRow | undefined> {
    const [row] = await tx
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), isActiveAnnouncement()))
      .for('update');
    return row;
  }

  async create(values: AnnouncementInsert, tx: DbOrTx): Promise<AnnouncementRow> {
    const [row] = await tx.insert(announcements).values(values).returning();
    if (!row) throw new Error('建立公告沒有回傳列');
    return row;
  }

  /**
   * 以樂觀鎖更新（使用者的編輯、送出、暫停、恢復都遞增 `version`）；版本不符或已刪除回 undefined。
   * 背景發送改狀態用 `setState`（不遞增：那不是使用者的編輯，ADR-0025 D3）。
   */
  async update(
    id: string,
    values: Partial<AnnouncementInsert>,
    expectedVersion: number,
    tx: DbOrTx,
  ): Promise<AnnouncementRow | undefined> {
    const [row] = await tx
      .update(announcements)
      .set({ ...values, updatedAt: new Date(), version: sql`${announcements.version} + 1` })
      .where(
        and(
          eq(announcements.id, id),
          eq(announcements.version, expectedVersion),
          isActiveAnnouncement(),
        ),
      )
      .returning();
    return row;
  }

  /** 系統改狀態（排程的發送完成）：不遞增 `version`、不改修改者。 */
  async setState(
    id: string,
    values: Pick<AnnouncementInsert, 'status' | 'nextRunAt'>,
    tx: DbOrTx,
  ): Promise<void> {
    await tx.update(announcements).set(values).where(eq(announcements.id, id));
  }

  /** 未刪除的公告目前的 `version`（樂觀鎖衝突時重讀）。 */
  async findVersion(id: string, tx: DbOrTx): Promise<number | undefined> {
    const [row] = await tx
      .select({ version: announcements.version })
      .from(announcements)
      .where(and(eq(announcements.id, id), isActiveAnnouncement()))
      .limit(1);
    return row?.version;
  }

  /** 軟刪除；排程中的改成暫停（還原後不會自己開始發，D19），排程的延遲工作因此變成 no-op。 */
  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(announcements)
      .set({
        deletedAt: new Date(),
        updatedBy: actorId,
        status: sql`CASE WHEN ${announcements.status} = 'scheduled' THEN 'paused' ELSE ${announcements.status} END`,
        nextRunAt: null,
      })
      .where(eq(announcements.id, id));
  }

  async findDeletedById(id: string): Promise<AnnouncementRow | undefined> {
    const [row] = await this.db
      .select()
      .from(announcements)
      .where(and(eq(announcements.id, id), isDeleted(announcements)))
      .limit(1);
    return row;
  }

  /** 已刪除或未刪除都算：用來區分 404 與「沒有被刪除」。 */
  async exists(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: announcements.id })
      .from(announcements)
      .where(eq(announcements.id, id))
      .limit(1);
    return Boolean(row);
  }

  /** 清掉 `deleted_at`（只在仍是已刪除時）；`version` 不遞增（與群組的還原相同）。 */
  async restore(id: string, actorId: string, tx: DbOrTx): Promise<AnnouncementRow | undefined> {
    const [row] = await tx
      .update(announcements)
      .set({ deletedAt: null, updatedBy: actorId })
      .where(and(eq(announcements.id, id), isDeleted(announcements)))
      .returning();
    return row;
  }

  async listDeleted(query: {
    offset: number;
    limit: number;
    keyword?: string;
  }): Promise<{ items: DeletedAnnouncementRow[]; total: number }> {
    const conditions: SQL[] = [isDeleted(announcements)];
    if (query.keyword) conditions.push(ilike(announcements.title, containsPattern(query.keyword)));
    const where = and(...conditions);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: announcements.id,
          title: announcements.title,
          status: announcements.status,
          deletedAt: announcements.deletedAt,
          deleterId: updater.id,
          deleterName: updater.displayName,
        })
        .from(announcements)
        .leftJoin(updater, eq(updater.id, announcements.updatedBy))
        .where(where)
        .orderBy(desc(announcements.deletedAt), desc(announcements.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db.select({ total: count() }).from(announcements).where(where),
    ]);
    return {
      items: rows.flatMap(({ deletedAt, deleterId, deleterName, ...row }) =>
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

  async findExpired(
    cutoff: Date,
    afterId: string | null,
    limit: number,
  ): Promise<Array<{ id: string; name: string; deletedAt: Date }>> {
    const rows = await this.db
      .select({
        id: announcements.id,
        name: announcements.title,
        deletedAt: announcements.deletedAt,
      })
      .from(announcements)
      .where(
        and(
          isDeleted(announcements),
          lt(announcements.deletedAt, cutoff),
          afterId ? gt(announcements.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(announcements.id))
      .limit(limit);
    return rows.flatMap(({ deletedAt, ...row }) => (deletedAt ? [{ ...row, deletedAt }] : []));
  }

  /** 永久刪除一則已刪除的公告；發送紀錄隨之刪除（CASCADE），通知依自己的保留期清除（沒有外鍵）。 */
  async hardDelete(id: string, tx: DbOrTx): Promise<boolean> {
    const rows = await tx
      .delete(announcements)
      .where(and(eq(announcements.id, id), isDeleted(announcements)))
      .returning({ id: announcements.id });
    return rows.length > 0;
  }

  // ── 發送紀錄 ─────────────────────────────────────────

  /**
   * 建立一次發送；同一則公告同一個時間已經有一筆時不建立（唯一索引），回傳 undefined。
   * 延遲工作重做、兩個 worker 同時拿到同一筆時只會有一次發送。
   */
  async insertDispatch(
    values: AnnouncementDispatchInsert,
    tx: DbOrTx,
  ): Promise<AnnouncementDispatchRow | undefined> {
    const [row] = await tx
      .insert(announcementDispatches)
      .values(values)
      .onConflictDoNothing()
      .returning();
    return row;
  }

  async findDispatch(id: string, tx?: DbOrTx): Promise<AnnouncementDispatchRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(announcementDispatches)
      .where(eq(announcementDispatches.id, id))
      .limit(1);
    return row;
  }

  async findDispatchWithPeople(id: string): Promise<DispatchWithPeople | undefined> {
    const [row] = await this.dispatchQuery().where(eq(announcementDispatches.id, id)).limit(1);
    return row && toDispatchWithPeople(row);
  }

  /** 鎖住一次發送（撤回與分批寫入互斥：撤回之後不會再有一批寫進去）。 */
  async lockDispatch(id: string, tx: DbOrTx): Promise<AnnouncementDispatchRow | undefined> {
    const [row] = await tx
      .select()
      .from(announcementDispatches)
      .where(eq(announcementDispatches.id, id))
      .for('update');
    return row;
  }

  async updateDispatch(
    id: string,
    values: Partial<AnnouncementDispatchInsert>,
    tx?: DbOrTx,
  ): Promise<void> {
    await (tx ?? this.db)
      .update(announcementDispatches)
      .set(values)
      .where(eq(announcementDispatches.id, id));
  }

  async listDispatches(
    announcementId: string,
    offset: number,
    limit: number,
  ): Promise<{ items: DispatchWithPeople[]; total: number }> {
    const where = eq(announcementDispatches.announcementId, announcementId);
    const [rows, [totalRow]] = await Promise.all([
      this.dispatchQuery()
        .where(where)
        .orderBy(desc(announcementDispatches.createdAt), desc(announcementDispatches.id))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(announcementDispatches).where(where),
    ]);
    return { items: rows.map(toDispatchWithPeople), total: totalRow?.total ?? 0 };
  }

  /** 每則公告最近的一次發送（列表用）。 */
  async latestDispatches(announcementIds: readonly string[]): Promise<AnnouncementDispatchRow[]> {
    if (announcementIds.length === 0) return [];
    return this.db
      .selectDistinctOn([announcementDispatches.announcementId])
      .from(announcementDispatches)
      .where(inArray(announcementDispatches.announcementId, [...announcementIds]))
      .orderBy(
        announcementDispatches.announcementId,
        desc(announcementDispatches.createdAt),
        desc(announcementDispatches.id),
      );
  }

  // ── 受眾 ─────────────────────────────────────────────

  /**
   * 可登入的使用者（未刪除、`active`、人）：與 `PermissionService.findActiveUserIdsWithPermission` 相同的條件。
   * 群組與角色展開後可能上萬人：分段查詢，避開 Postgres 單一語句 65535 個參數的上限。
   */
  async filterRecipients(userIds: readonly string[]): Promise<string[]> {
    const result: string[] = [];
    for (let start = 0; start < userIds.length; start += RECIPIENT_FILTER_CHUNK) {
      // oxlint-disable-next-line no-await-in-loop -- 分段查詢，避免一次佔用多條連線
      const rows = await this.db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            inArray(users.id, userIds.slice(start, start + RECIPIENT_FILTER_CHUNK)),
            eq(users.status, 'active'),
            notDeleted(users),
            isHumanUser(),
          ),
        );
      result.push(...rows.map((row) => row.id));
    }
    return result.toSorted();
  }

  /** 全租戶：所有可登入的使用者。 */
  async allRecipients(): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.status, 'active'), notDeleted(users), isHumanUser()))
      .orderBy(asc(users.id));
    return rows.map((row) => row.id);
  }

  async activeGroupIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: groups.id })
      .from(groups)
      .where(and(inArray(groups.id, [...ids]), notDeleted(groups)));
    return rows.map((row) => row.id);
  }

  async activeRoleIds(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(inArray(roles.id, [...ids]), notDeleted(roles)));
    return rows.map((row) => row.id);
  }

  private dispatchQuery() {
    return this.db
      .select({
        dispatch: announcementDispatches,
        creatorId: creator.id,
        creatorName: creator.displayName,
        revokerId: revoker.id,
        revokerName: revoker.displayName,
      })
      .from(announcementDispatches)
      .leftJoin(creator, eq(creator.id, announcementDispatches.createdBy))
      .leftJoin(revoker, eq(revoker.id, announcementDispatches.revokedBy))
      .$dynamic();
  }
}

function toDispatchWithPeople(row: {
  dispatch: AnnouncementDispatchRow;
  creatorId: string | null;
  creatorName: string | null;
  revokerId: string | null;
  revokerName: string | null;
}): DispatchWithPeople {
  return {
    ...row.dispatch,
    creator: person(row.creatorId, row.creatorName),
    revoker: person(row.revokerId, row.revokerName),
  };
}
