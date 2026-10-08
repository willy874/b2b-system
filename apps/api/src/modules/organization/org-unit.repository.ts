import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database, DbOrTx } from '@/core/database';
import { containsPattern, TENANT_DB } from '@/core/database';
import type { OrgUnitInsert, OrgUnitRow } from '@/db/schema';
import { isDeleted, notDeleted, orgUnitMembers, orgUnits, users } from '@/db/schema';

/**
 * 部門結構（建立、搬移、刪除、還原）的寫入以交易層級的 advisory lock 排隊：循環與層數的檢查要看到一致的樹，
 * 兩個相反方向的搬移不能同時通過（與群組的 `group_membership` 同一個做法）。
 */
const STRUCTURE_LOCK_KEY = 'org_structure';

/** 刪除者：`users` 的別名。 */
const deleter = alias(users, 'deleter');

export interface OrgUnitWithCounts extends OrgUnitRow {
  memberCount: number;
  managerCount: number;
  /** 主管（未刪除的使用者，依名稱）：組織圖的節點顯示主管名字。 */
  managers: Array<{ userId: string; displayName: string }>;
}

export interface OrgUnitMemberView {
  userId: string;
  displayName: string;
  email: string;
  status: 'pending' | 'active' | 'inactive' | 'locked';
  unitId: string;
  unitName: string;
  isManager: boolean;
  isPrimary: boolean;
  title: string | null;
}

/** 稽核用的成員快照。 */
export interface OrgUnitMemberSnapshot {
  userId: string;
  isManager: boolean;
  isPrimary: boolean;
  title: string | null;
}

export interface DeletedOrgUnitRow {
  id: string;
  name: string;
  description: string | null;
  deletedAt: Date;
  deletedBy: { id: string; name: string } | null;
}

// 子查詢以別名 m 表示成員；已刪除的使用者不算（成員資格保留，還原使用者時回來）
const ACTIVE_MEMBER = sql`EXISTS (SELECT 1 FROM users u WHERE u.id = m.user_id AND u.deleted_at IS NULL /* notDeleted */)`;
// 單表 select 時 Drizzle 會把 ${orgUnits.id} 輸出成不帶表名的 "id"；明確寫出表名才會關聯到外層
const OUTER_UNIT_ID = sql`${orgUnits}.${sql.identifier(orgUnits.id.name)}`;
const memberCount = sql<number>`(SELECT count(*)::int FROM ${orgUnitMembers} m
  WHERE m.unit_id = ${OUTER_UNIT_ID} AND ${ACTIVE_MEMBER})`;
const managerCount = sql<number>`(SELECT count(*)::int FROM ${orgUnitMembers} m
  WHERE m.unit_id = ${OUTER_UNIT_ID} AND m.is_manager AND ${ACTIVE_MEMBER})`;
const managers = sql<Array<{ userId: string; displayName: string }>>`(SELECT coalesce(
    json_agg(json_build_object('userId', u.id, 'displayName', u.display_name) ORDER BY u.display_name, u.id),
    '[]'::json)
  FROM ${orgUnitMembers} m JOIN ${users} u ON u.id = m.user_id
  WHERE m.unit_id = ${OUTER_UNIT_ID} AND m.is_manager AND u.deleted_at IS NULL /* notDeleted */)`;

@Injectable()
export class OrgUnitRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  // ── 部門 ─────────────────────────────────────────────

  /** 整棵樹（未刪除），同層依 `sort_order`、名稱排序。 */
  async listAll(): Promise<OrgUnitWithCounts[]> {
    return this.db
      .select({ unit: orgUnits, memberCount, managerCount, managers })
      .from(orgUnits)
      .where(notDeleted(orgUnits))
      .orderBy(asc(orgUnits.sortOrder), asc(orgUnits.name))
      .then((rows) => rows.map(({ unit, ...counts }) => ({ ...unit, ...counts })));
  }

  /** 名稱或代碼符合關鍵字的部門 id（上層由呼叫端補齊）。 */
  async matchKeyword(keyword: string): Promise<string[]> {
    const pattern = containsPattern(keyword);
    const rows = await this.db
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          notDeleted(orgUnits),
          sql`(${orgUnits.name} ILIKE ${pattern} OR ${orgUnits.code}::text ILIKE ${pattern})`,
        ),
      );
    return rows.map((row) => row.id);
  }

  async withCounts(id: string): Promise<OrgUnitWithCounts | undefined> {
    const [row] = await this.db
      .select({ unit: orgUnits, memberCount, managerCount, managers })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, id), notDeleted(orgUnits)))
      .limit(1);
    return (
      row && {
        ...row.unit,
        memberCount: row.memberCount,
        managerCount: row.managerCount,
        managers: row.managers,
      }
    );
  }

  async findById(id: string, tx?: DbOrTx): Promise<OrgUnitRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(orgUnits)
      .where(and(eq(orgUnits.id, id), notDeleted(orgUnits)))
      .limit(1);
    return row;
  }

  /** 未刪除的部門中，這些 id 有哪些。 */
  async findActiveIds(ids: readonly string[], tx?: DbOrTx): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await (tx ?? this.db)
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(inArray(orgUnits.id, [...ids]), notDeleted(orgUnits)));
    return rows.map((row) => row.id);
  }

  /** 部門的名稱（含已刪除的）：審批規則的顯示名稱。 */
  async findNames(
    ids: readonly string[],
  ): Promise<Map<string, { name: string; deleted: boolean }>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({ id: orgUnits.id, name: orgUnits.name, deletedAt: orgUnits.deletedAt })
      .from(orgUnits)
      .where(inArray(orgUnits.id, [...ids]));
    return new Map(
      rows.map((row) => [row.id, { name: row.name, deleted: row.deletedAt !== null }]),
    );
  }

  /** 同一個上層之下名稱相同（不分大小寫）的未刪除部門；`excludeId` 排除自己。 */
  async findSiblingByName(
    parentId: string | null,
    name: string,
    excludeId?: string,
    tx?: DbOrTx,
  ): Promise<OrgUnitRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(orgUnits)
      .where(
        and(
          notDeleted(orgUnits),
          parentId ? eq(orgUnits.parentId, parentId) : isNull(orgUnits.parentId),
          sql`lower(${orgUnits.name}) = lower(${name})`,
          excludeId ? ne(orgUnits.id, excludeId) : undefined,
        ),
      )
      .limit(1);
    return row;
  }

  /** 代碼相同（citext，不分大小寫）的未刪除部門。 */
  async findByCode(code: string, excludeId?: string): Promise<OrgUnitRow | undefined> {
    const [row] = await this.db
      .select()
      .from(orgUnits)
      .where(
        and(
          notDeleted(orgUnits),
          eq(orgUnits.code, code),
          excludeId ? ne(orgUnits.id, excludeId) : undefined,
        ),
      )
      .limit(1);
    return row;
  }

  /** 同一個上層之下的未刪除部門（依目前的排序）。 */
  async listSiblings(parentId: string | null, tx: DbOrTx): Promise<OrgUnitRow[]> {
    return tx
      .select()
      .from(orgUnits)
      .where(
        and(
          notDeleted(orgUnits),
          parentId ? eq(orgUnits.parentId, parentId) : isNull(orgUnits.parentId),
        ),
      )
      .orderBy(asc(orgUnits.sortOrder), asc(orgUnits.name), asc(orgUnits.id));
  }

  async nextSortOrder(parentId: string | null, tx: DbOrTx): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${orgUnits.sortOrder})` })
      .from(orgUnits)
      .where(
        and(
          notDeleted(orgUnits),
          parentId ? eq(orgUnits.parentId, parentId) : isNull(orgUnits.parentId),
        ),
      );
    return (row?.max ?? -1) + 1;
  }

  async create(values: OrgUnitInsert, tx: DbOrTx): Promise<OrgUnitRow> {
    const [row] = await tx.insert(orgUnits).values(values).returning();
    if (!row) throw new Error('建立部門失敗');
    return row;
  }

  /** 改名稱、代碼、說明或上層並遞增 `version`；版本不符或已刪除回 undefined。 */
  async update(
    id: string,
    values: Partial<
      Pick<OrgUnitInsert, 'name' | 'code' | 'description' | 'parentId' | 'sortOrder' | 'updatedBy'>
    >,
    expectedVersion: number,
    tx: DbOrTx,
  ): Promise<OrgUnitRow | undefined> {
    const [row] = await tx
      .update(orgUnits)
      .set({ ...values, version: sql`${orgUnits.version} + 1`, updatedAt: new Date() })
      .where(and(eq(orgUnits.id, id), eq(orgUnits.version, expectedVersion), notDeleted(orgUnits)))
      .returning();
    return row;
  }

  /** 重新編排同層的順序（不遞增 `version`：排序不是部門自己的內容）。 */
  async setSortOrders(order: readonly string[], tx: DbOrTx): Promise<void> {
    if (!order.length) return;
    const cases = sql.join(
      order.map((id, index) => sql`WHEN ${id}::uuid THEN ${index}`),
      sql` `,
    );
    await tx
      .update(orgUnits)
      .set({ sortOrder: sql`CASE ${orgUnits.id} ${cases} END` })
      .where(inArray(orgUnits.id, [...order]));
  }

  async findVersion(id: string, tx: DbOrTx): Promise<number | undefined> {
    const [row] = await tx
      .select({ version: orgUnits.version })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, id), notDeleted(orgUnits)))
      .limit(1);
    return row?.version;
  }

  /** 部門結構的寫入排隊（見 `STRUCTURE_LOCK_KEY`）。在交易內、檢查之前呼叫。 */
  async lockStructure(tx: DbOrTx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${STRUCTURE_LOCK_KEY}))`);
  }

  async lockActiveRow(id: string, tx: DbOrTx): Promise<OrgUnitRow | undefined> {
    const [row] = await tx
      .select()
      .from(orgUnits)
      .where(and(eq(orgUnits.id, id), notDeleted(orgUnits)))
      .for('update');
    return row;
  }

  /**
   * 上層（不含自己），最近的在前：`depth` 1 是直接上層。已刪除的上層也列出（`deleted`），呼叫端決定怎麼處理。
   */
  async ancestors(
    id: string,
    tx?: DbOrTx,
  ): Promise<Array<{ id: string; name: string; depth: number; deleted: boolean }>> {
    const rows = await (tx ?? this.db).execute<{
      id: string;
      name: string;
      depth: number;
      deleted: boolean;
    }>(sql`
      WITH RECURSIVE up(id, parent_id, name, deleted, depth) AS (
        SELECT p.id, p.parent_id, p.name, p.deleted_at IS NOT NULL, 1
        FROM ${orgUnits} c JOIN ${orgUnits} p ON p.id = c.parent_id
        WHERE c.id = ${id}
        UNION ALL
        SELECT p.id, p.parent_id, p.name, p.deleted_at IS NOT NULL, up.depth + 1
        FROM up JOIN ${orgUnits} p ON p.id = up.parent_id
        WHERE up.depth < 64
      )
      SELECT id, name, depth, deleted FROM up ORDER BY depth`);
    return [...rows];
  }

  /** 每個部門的上層路徑（最上層在前，不含自己）；只走未刪除的部門。 */
  async pathsOf(ids: readonly string[]): Promise<Map<string, Array<{ id: string; name: string }>>> {
    const result = new Map<string, Array<{ id: string; name: string }>>();
    if (!ids.length) return result;
    const rows = await this.db.execute<{
      root: string;
      id: string;
      name: string;
      depth: number;
    }>(sql`
      WITH RECURSIVE up(root, id, parent_id, name, depth) AS (
        SELECT c.id, p.id, p.parent_id, p.name, 1
        FROM ${orgUnits} c JOIN ${orgUnits} p ON p.id = c.parent_id
        WHERE c.id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
        UNION ALL
        SELECT up.root, p.id, p.parent_id, p.name, up.depth + 1
        FROM up JOIN ${orgUnits} p ON p.id = up.parent_id
        WHERE up.depth < 64
      )
      SELECT root, id, name, depth FROM up ORDER BY root, depth DESC`);
    for (const row of rows) {
      const path = result.get(row.root) ?? [];
      path.push({ id: row.id, name: row.name });
      result.set(row.root, path);
    }
    return result;
  }

  /** 自己與所有下層（未刪除），`depth` 0 是自己。 */
  async descendants(id: string, tx?: DbOrTx): Promise<Array<{ id: string; depth: number }>> {
    const rows = await (tx ?? this.db).execute<{ id: string; depth: number }>(sql`
      WITH RECURSIVE down(id, depth) AS (
        SELECT ${id}::uuid, 0
        UNION ALL
        SELECT c.id, down.depth + 1
        FROM down JOIN ${orgUnits} c ON c.parent_id = down.id
        WHERE c.deleted_at IS NULL /* notDeleted */ AND down.depth < 64
      )
      SELECT id, depth FROM down`);
    return [...rows];
  }

  async hasActiveChildren(id: string, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(eq(orgUnits.parentId, id), notDeleted(orgUnits)))
      .limit(1);
    return Boolean(row);
  }

  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(orgUnits)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(eq(orgUnits.id, id));
  }

  async restore(id: string, actorId: string, tx: DbOrTx): Promise<OrgUnitRow | undefined> {
    const [row] = await tx
      .update(orgUnits)
      .set({ deletedAt: null, updatedBy: actorId })
      .where(and(eq(orgUnits.id, id), isDeleted(orgUnits)))
      .returning();
    return row;
  }

  async findDeletedById(id: string): Promise<OrgUnitRow | undefined> {
    const [row] = await this.db
      .select()
      .from(orgUnits)
      .where(and(eq(orgUnits.id, id), isDeleted(orgUnits)))
      .limit(1);
    return row;
  }

  async exists(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(eq(orgUnits.id, id))
      .limit(1);
    return Boolean(row);
  }

  async listDeleted(query: {
    offset: number;
    limit: number;
    keyword?: string;
  }): Promise<{ items: DeletedOrgUnitRow[]; total: number }> {
    const conditions: SQL[] = [isDeleted(orgUnits)];
    if (query.keyword) {
      conditions.push(sql`${orgUnits.name} ILIKE ${containsPattern(query.keyword)}`);
    }
    const where = and(...conditions);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: orgUnits.id,
          name: orgUnits.name,
          description: orgUnits.description,
          deletedAt: orgUnits.deletedAt,
          deleterId: deleter.id,
          deleterName: deleter.displayName,
        })
        .from(orgUnits)
        .leftJoin(deleter, eq(deleter.id, orgUnits.updatedBy))
        .where(where)
        .orderBy(desc(orgUnits.deletedAt), desc(orgUnits.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(orgUnits)
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
   * 刪除超過保留期限的部門（依 id 的 keyset）。還有任何下層（含已刪除、尚未到期的）的部門這一輪略過：
   * `parent_id` 是 RESTRICT，先刪下層，下一輪再刪它。
   */
  async findExpired(
    cutoff: Date,
    afterId: string | null,
    limit: number,
  ): Promise<Array<{ id: string; name: string; deletedAt: Date }>> {
    const rows = await this.db
      .select({ id: orgUnits.id, name: orgUnits.name, deletedAt: orgUnits.deletedAt })
      .from(orgUnits)
      .where(
        and(
          isDeleted(orgUnits),
          lt(orgUnits.deletedAt, cutoff),
          afterId ? gt(orgUnits.id, afterId) : undefined,
          sql`NOT EXISTS (SELECT 1 FROM ${orgUnits} c WHERE c.parent_id = ${OUTER_UNIT_ID})`,
        ),
      )
      .orderBy(asc(orgUnits.id))
      .limit(limit);
    return rows.flatMap(({ deletedAt, ...row }) => (deletedAt ? [{ ...row, deletedAt }] : []));
  }

  /** 永久刪除一個已刪除的部門；成員資格隨外鍵 CASCADE 刪除。 */
  async hardDelete(id: string, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .delete(orgUnits)
      .where(and(eq(orgUnits.id, id), isDeleted(orgUnits)))
      .returning({ id: orgUnits.id });
    return Boolean(row);
  }

  async countImpact(): Promise<{ units: number; members: number }> {
    const [row] = await this.db.execute<{ units: number; members: number }>(sql`
      SELECT
        (SELECT count(*)::int FROM ${orgUnits} o WHERE o.deleted_at IS NULL /* notDeleted */) AS units,
        (SELECT count(DISTINCT m.user_id)::int FROM ${orgUnitMembers} m
          JOIN ${orgUnits} o ON o.id = m.unit_id AND o.deleted_at IS NULL /* notDeleted */
          WHERE ${ACTIVE_MEMBER}) AS members`);
    return { units: row?.units ?? 0, members: row?.members ?? 0 };
  }

  // ── 成員 ─────────────────────────────────────────────

  async listMembers(
    unitIds: readonly string[],
    query: { offset: number; limit: number; keyword?: string },
  ): Promise<{ items: OrgUnitMemberView[]; total: number }> {
    const conditions: SQL[] = [inArray(orgUnitMembers.unitId, [...unitIds]), notDeleted(users)];
    if (query.keyword) {
      const pattern = containsPattern(query.keyword);
      conditions.push(
        sql`(${users.displayName} ILIKE ${pattern} OR ${users.email} ILIKE ${pattern})`,
      );
    }
    const where = and(...conditions);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          userId: users.id,
          displayName: users.displayName,
          email: users.email,
          status: users.status,
          unitId: orgUnits.id,
          unitName: orgUnits.name,
          isManager: orgUnitMembers.isManager,
          isPrimary: orgUnitMembers.isPrimary,
          title: orgUnitMembers.title,
        })
        .from(orgUnitMembers)
        .innerJoin(users, eq(users.id, orgUnitMembers.userId))
        .innerJoin(orgUnits, eq(orgUnits.id, orgUnitMembers.unitId))
        .where(where)
        // 主管在前，再依名稱
        .orderBy(desc(orgUnitMembers.isManager), asc(users.displayName), asc(users.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(orgUnitMembers)
        .innerJoin(users, eq(users.id, orgUnitMembers.userId))
        .where(where),
    ]);
    return { items: rows, total: counted?.total ?? 0 };
  }

  /** 這個部門目前的成員（含已刪除的使用者：稽核的前後對照要完整）。 */
  async memberSnapshot(unitId: string, tx: DbOrTx): Promise<OrgUnitMemberSnapshot[]> {
    return tx
      .select({
        userId: orgUnitMembers.userId,
        isManager: orgUnitMembers.isManager,
        isPrimary: orgUnitMembers.isPrimary,
        title: orgUnitMembers.title,
      })
      .from(orgUnitMembers)
      .where(eq(orgUnitMembers.unitId, unitId))
      .orderBy(asc(orgUnitMembers.userId));
  }

  /** 這個部門的成員 id（未刪除的使用者）：推播的受眾。 */
  async memberUserIds(unitId: string, tx?: DbOrTx): Promise<string[]> {
    const rows = await (tx ?? this.db)
      .select({ userId: orgUnitMembers.userId })
      .from(orgUnitMembers)
      .innerJoin(users, eq(users.id, orgUnitMembers.userId))
      .where(and(eq(orgUnitMembers.unitId, unitId), notDeleted(users)));
    return rows.map((row) => row.userId);
  }

  async upsertMembers(
    unitId: string,
    members: ReadonlyArray<{
      userId: string;
      isManager?: boolean;
      isPrimary?: boolean;
      title?: string | null;
    }>,
    actorId: string,
    tx: DbOrTx,
  ): Promise<void> {
    for (const member of members) {
      // oxlint-disable-next-line no-await-in-loop -- 每一列的更新欄位不同（只改有帶的欄位）；一次最多 200 列
      await tx
        .insert(orgUnitMembers)
        .values({
          unitId,
          userId: member.userId,
          isManager: member.isManager ?? false,
          isPrimary: member.isPrimary ?? false,
          title: member.title ?? null,
          createdBy: actorId,
        })
        .onConflictDoUpdate({
          target: [orgUnitMembers.unitId, orgUnitMembers.userId],
          set: {
            ...(member.isManager !== undefined && { isManager: member.isManager }),
            ...(member.isPrimary !== undefined && { isPrimary: member.isPrimary }),
            ...(member.title !== undefined && { title: member.title }),
          },
        });
    }
  }

  /** 取消這些人在 **其他** 部門的主要部門（把主要部門設到 `unitId` 之前呼叫）。 */
  async clearPrimaryElsewhere(
    unitId: string,
    userIds: readonly string[],
    tx: DbOrTx,
  ): Promise<void> {
    if (!userIds.length) return;
    await tx
      .update(orgUnitMembers)
      .set({ isPrimary: false })
      .where(
        and(
          inArray(orgUnitMembers.userId, [...userIds]),
          ne(orgUnitMembers.unitId, unitId),
          eq(orgUnitMembers.isPrimary, true),
        ),
      );
  }

  async removeMembers(unitId: string, userIds: readonly string[], tx: DbOrTx): Promise<void> {
    if (!userIds.length) return;
    await tx
      .delete(orgUnitMembers)
      .where(and(eq(orgUnitMembers.unitId, unitId), inArray(orgUnitMembers.userId, [...userIds])));
  }

  /** 那個人所屬的（未刪除）部門，主要部門在前。 */
  async unitsOfUser(userId: string): Promise<
    Array<{
      unitId: string;
      name: string;
      isManager: boolean;
      isPrimary: boolean;
      title: string | null;
    }>
  > {
    return this.db
      .select({
        unitId: orgUnits.id,
        name: orgUnits.name,
        isManager: orgUnitMembers.isManager,
        isPrimary: orgUnitMembers.isPrimary,
        title: orgUnitMembers.title,
      })
      .from(orgUnitMembers)
      .innerJoin(orgUnits, eq(orgUnits.id, orgUnitMembers.unitId))
      .where(and(eq(orgUnitMembers.userId, userId), notDeleted(orgUnits)))
      .orderBy(desc(orgUnitMembers.isPrimary), asc(orgUnits.name));
  }

  /** 未刪除的使用者中，這些 id 有哪些。 */
  async findActiveUserIds(ids: readonly string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, [...ids]), notDeleted(users)));
    return rows.map((row) => row.id);
  }

  // ── 主管的解析（docs/architecture/backend/23-organization.md §3） ──

  /**
   * 從某人的主要部門往上走，每一層的主管（`status = active`、未刪除、人類帳號；不含 `excludeUserId`）。
   * 回傳依層數（0 = 主要部門本身）排序；沒有主要部門時是空陣列。路徑上已刪除的部門照樣往上走（它的主管不算）。
   */
  async managerChainOfUser(
    userId: string,
    excludeUserId: string,
    tx?: DbOrTx,
  ): Promise<Array<{ depth: number; managerIds: string[] }>> {
    const rows = await (tx ?? this.db).execute<{ depth: number; manager_ids: string[] | null }>(sql`
      WITH RECURSIVE chain(id, parent_id, deleted, depth) AS (
        SELECT o.id, o.parent_id, o.deleted_at IS NOT NULL, 0
        FROM ${orgUnitMembers} pm JOIN ${orgUnits} o ON o.id = pm.unit_id
        WHERE pm.user_id = ${userId} AND pm.is_primary
        UNION ALL
        SELECT p.id, p.parent_id, p.deleted_at IS NOT NULL, chain.depth + 1
        FROM chain JOIN ${orgUnits} p ON p.id = chain.parent_id
        WHERE chain.depth < 64
      )
      SELECT chain.depth,
        CASE WHEN chain.deleted THEN NULL ELSE (
          SELECT array_agg(m.user_id::text ORDER BY m.user_id)
          FROM ${orgUnitMembers} m JOIN ${users} u ON u.id = m.user_id
          WHERE m.unit_id = chain.id AND m.is_manager AND m.user_id <> ${excludeUserId}
            AND u.status = 'active' AND u.kind = 'human' AND u.deleted_at IS NULL /* notDeleted */
        ) END AS manager_ids
      FROM chain ORDER BY chain.depth`);
    return rows.map((row) => ({ depth: row.depth, managerIds: row.manager_ids ?? [] }));
  }

  /** 部門的主管（只看這個部門；已刪除的部門沒有主管）。條件同 `managerChainOfUser`。 */
  async managersOfUnit(unitId: string, tx?: DbOrTx): Promise<string[]> {
    const rows = await (tx ?? this.db)
      .select({ userId: orgUnitMembers.userId })
      .from(orgUnitMembers)
      .innerJoin(users, eq(users.id, orgUnitMembers.userId))
      .innerJoin(orgUnits, eq(orgUnits.id, orgUnitMembers.unitId))
      .where(
        and(
          eq(orgUnitMembers.unitId, unitId),
          eq(orgUnitMembers.isManager, true),
          notDeleted(orgUnits),
          notDeleted(users),
          eq(users.status, 'active'),
          eq(users.kind, 'human'),
        ),
      )
      .orderBy(asc(orgUnitMembers.userId));
    return rows.map((row) => row.userId);
  }
}
