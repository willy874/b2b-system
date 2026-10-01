import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, containsPattern } from '@/core/database';
import type { GroupInsert, GroupMemberSubject, GroupRow } from '@/db/schema';
import {
  GROUP_MEMBER_RELATION,
  GROUP_OBJECT_TYPE,
  groupMemberTuple,
  groupRoleTuple,
  groups,
  isActiveGroup,
  isActiveRole,
  isDeleted,
  isGroupMemberTuple,
  isGroupRoleTuple,
  notDeleted,
  relationTuples,
  ROLE_HOLDER_RELATION,
  ROLE_OBJECT_TYPE,
  roles,
  USER_SUBJECT_TYPE,
  users,
} from '@/db/schema';

import type { ListGroupDto } from './dto/list-group.dto';

export interface GroupWithCounts extends GroupRow {
  memberCount: number;
  roleCount: number;
}

/** 群組的一個直接成員（`listMembers`）。 */
export interface GroupMemberRow {
  type: 'user' | 'group';
  id: string;
  name: string;
  email: string | null;
  status: 'pending' | 'active' | 'inactive' | 'locked' | null;
}

/**
 * 群組結構（成員之間的巢狀）的寫入以交易層級的 advisory lock 排隊：循環與巢狀層數的檢查要看到一致的結構，
 * 兩個相反方向的「把 A 加進 B」「把 B 加進 A」不能同時通過（與資料夾樹同一個做法，docs/architecture/backend/09-file.md §4.2）。
 */
const MEMBERSHIP_LOCK_KEY = 'group_membership';

// 子查詢裡的邊以別名 t 表示；條件與 db/schema 的 isGroupMemberTuple()／isGroupRoleTuple() 相同。
// 已刪除的使用者、群組、角色不算（它們的邊保留，還原時回來）。
const memberCountOf = (groupId: SQLWrapper | string) =>
  sql<number>`(SELECT count(*)::int FROM ${relationTuples} t
    WHERE t.object_type = ${GROUP_OBJECT_TYPE} AND t.relation = ${GROUP_MEMBER_RELATION}
      AND t.object_id = ${groupId}::text
      AND (
        (t.subject_type = ${USER_SUBJECT_TYPE} AND t.subject_relation = ''
          AND EXISTS (SELECT 1 FROM users u WHERE u.id::text = t.subject_id AND u.deleted_at IS NULL /* notDeleted */))
        OR (t.subject_type = ${GROUP_OBJECT_TYPE} AND t.subject_relation = ${GROUP_MEMBER_RELATION}
          AND EXISTS (SELECT 1 FROM groups g WHERE g.id::text = t.subject_id AND g.deleted_at IS NULL /* notDeleted */))
      ))`;

const roleCountOf = (groupId: SQLWrapper | string) =>
  sql<number>`(SELECT count(*)::int FROM ${relationTuples} t
    WHERE t.object_type = ${ROLE_OBJECT_TYPE} AND t.relation = ${ROLE_HOLDER_RELATION}
      AND t.subject_type = ${GROUP_OBJECT_TYPE} AND t.subject_relation = ${GROUP_MEMBER_RELATION}
      AND t.subject_id = ${groupId}::text
      AND EXISTS (SELECT 1 FROM roles r WHERE r.id::text = t.object_id AND r.deleted_at IS NULL /* notDeleted */))`;

// 單表 select 時 Drizzle 會把 ${groups.id} 輸出成不帶表名的 "id"；明確寫出表名才會關聯到外層的群組
const OUTER_GROUP_ID = sql`${groups}.${sql.identifier(groups.id.name)}`;

const SORT_COLUMNS = {
  createdAt: groups.createdAt,
  name: groups.name,
  memberCount: memberCountOf(OUTER_GROUP_ID),
  roleCount: roleCountOf(OUTER_GROUP_ID),
} as const;

/** 這個群組的成員邊（`group:<id>#member@…`）。不看群組是否刪除：呼叫端先確認群組的狀態。 */
const membersOf = (groupId: string) =>
  and(isGroupMemberTuple(), eq(relationTuples.objectId, groupId));
/** 這個群組持有角色的邊（`role:*#holder@group:<id>#member`）。 */
const rolesOf = (groupId: string) => and(isGroupRoleTuple(), eq(relationTuples.subjectId, groupId));

@Injectable()
export class GroupRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async findById(id: string, tx?: DbOrTx): Promise<GroupRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(groups)
      .where(and(eq(groups.id, id), isActiveGroup()))
      .limit(1);
    return row;
  }

  /** 名稱不分大小寫（與唯一索引 `groups_name_key` 的 `lower(name)` 一致）。 */
  async findByName(name: string): Promise<GroupRow | undefined> {
    const [row] = await this.db
      .select()
      .from(groups)
      .where(and(sql`lower(${groups.name}) = lower(${name})`, isActiveGroup()))
      .limit(1);
    return row;
  }

  async withCounts(id: string): Promise<GroupWithCounts | undefined> {
    const group = await this.findById(id);
    if (!group) return undefined;
    const [counts] = await this.db
      .select({ memberCount: memberCountOf(id), roleCount: roleCountOf(id) })
      .from(groups)
      .where(eq(groups.id, id))
      .limit(1);
    return { ...group, memberCount: counts?.memberCount ?? 0, roleCount: counts?.roleCount ?? 0 };
  }

  async list(query: ListGroupDto): Promise<{ items: GroupWithCounts[]; total: number }> {
    const conditions: SQL[] = [isActiveGroup()];
    if (query.keyword) {
      const pattern = containsPattern(query.keyword);
      conditions.push(
        sql`(${groups.name} ILIKE ${pattern} OR ${groups.description} ILIKE ${pattern})`,
      );
    }
    const where = and(...conditions);
    // 依 sort 陣列的順序排；最後以 id 收尾，讓同值的列在分頁之間順序穩定
    const orderBy = query.sort.map(({ sort, order }) =>
      order === 'asc' ? asc(SORT_COLUMNS[sort]) : desc(SORT_COLUMNS[sort]),
    );
    const [items, [counted]] = await Promise.all([
      this.db
        .select({
          group: groups,
          memberCount: SORT_COLUMNS.memberCount,
          roleCount: SORT_COLUMNS.roleCount,
        })
        .from(groups)
        .where(where)
        .orderBy(...orderBy, desc(groups.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(groups)
        .where(where),
    ]);
    return {
      items: items.map((row) => ({
        ...row.group,
        memberCount: row.memberCount,
        roleCount: row.roleCount,
      })),
      total: counted?.total ?? 0,
    };
  }

  async create(values: GroupInsert, tx: DbOrTx): Promise<GroupRow> {
    const [row] = await tx.insert(groups).values(values).returning();
    if (!row) throw new Error('建立群組失敗');
    return row;
  }

  /** 改名稱或說明並遞增 `version`；只在版本相符、且未刪除時才更新，不符回 undefined（ADR-0025 D3）。 */
  async update(
    id: string,
    values: Partial<Pick<GroupInsert, 'name' | 'description' | 'updatedBy'>>,
    expectedVersion: number,
    tx: DbOrTx,
  ): Promise<GroupRow | undefined> {
    const [row] = await tx
      .update(groups)
      .set({ ...values, version: sql`${groups.version} + 1` })
      .where(and(eq(groups.id, id), eq(groups.version, expectedVersion), isActiveGroup()))
      .returning();
    return row;
  }

  /** 未刪除的群組目前的 `version`；不存在或已刪除回 undefined（樂觀鎖衝突時重讀）。 */
  async findVersion(id: string, tx: DbOrTx): Promise<number | undefined> {
    const [row] = await tx
      .select({ version: groups.version })
      .from(groups)
      .where(and(eq(groups.id, id), isActiveGroup()))
      .limit(1);
    return row?.version;
  }

  /** 在交易內以 `FOR UPDATE` 鎖住並讀出未刪除的群組列；不存在（或已刪除）時回 undefined。 */
  async lockActiveRow(id: string, tx: DbOrTx): Promise<GroupRow | undefined> {
    const [row] = await tx
      .select()
      .from(groups)
      .where(and(eq(groups.id, id), isActiveGroup()))
      .for('update');
    return row;
  }

  /** 群組結構的寫入排隊（見 `MEMBERSHIP_LOCK_KEY`）。在交易內、檢查之前呼叫。 */
  async lockMembership(tx: DbOrTx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${MEMBERSHIP_LOCK_KEY}))`);
  }

  /**
   * 軟刪除群組。成員與持有角色的邊、以群組為對象的資料夾授權都 **保留**（休眠）：解析已排除刪除的群組，
   * 還原時一起回來（與角色相同，ADR-0025 D2）。關係圖的 revision 由 trigger（migration 0017）+1。
   */
  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(groups)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(eq(groups.id, id));
  }

  // ── 成員 ─────────────────────────────────────────────

  /** 直接成員（未刪除的使用者與群組），使用者在前、各自依名稱排序。呼叫端先確認群組未刪除。 */
  async listMembers(
    groupId: string,
    offset: number,
    limit: number,
  ): Promise<{ items: GroupMemberRow[]; total: number }> {
    const rows = sql`
      SELECT 'user' AS type, u.id::text AS id, u.display_name AS name, u.email AS email, u.status::text AS status
      FROM ${relationTuples} t JOIN ${users} u ON u.id::text = t.subject_id AND u.deleted_at IS NULL /* notDeleted */
      WHERE t.object_type = ${GROUP_OBJECT_TYPE} AND t.object_id = ${groupId} AND t.relation = ${GROUP_MEMBER_RELATION}
        AND t.subject_type = ${USER_SUBJECT_TYPE} AND t.subject_relation = ''
      UNION ALL
      SELECT 'group' AS type, g.id::text AS id, g.name AS name, NULL AS email, NULL AS status
      FROM ${relationTuples} t JOIN ${groups} g ON g.id::text = t.subject_id AND g.deleted_at IS NULL /* notDeleted */
      WHERE t.object_type = ${GROUP_OBJECT_TYPE} AND t.object_id = ${groupId} AND t.relation = ${GROUP_MEMBER_RELATION}
        AND t.subject_type = ${GROUP_OBJECT_TYPE} AND t.subject_relation = ${GROUP_MEMBER_RELATION}`;
    const [items, [counted]] = await Promise.all([
      this.db.execute<GroupMemberRow & Record<string, unknown>>(sql`
        SELECT * FROM (${rows}) m
        ORDER BY CASE m.type WHEN 'user' THEN 0 ELSE 1 END, lower(m.name), m.id
        LIMIT ${limit} OFFSET ${offset}`),
      this.db.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM (${rows}) m`),
    ]);
    return { items: [...items], total: counted?.total ?? 0 };
  }

  async addMembers(
    groupId: string,
    members: readonly GroupMemberSubject[],
    actorId: string,
    tx: DbOrTx,
  ): Promise<void> {
    if (!members.length) return;
    await tx
      .insert(relationTuples)
      .values(members.map((member) => groupMemberTuple(groupId, member, actorId)))
      .onConflictDoNothing();
  }

  async removeMembers(
    groupId: string,
    members: readonly GroupMemberSubject[],
    tx: DbOrTx,
  ): Promise<void> {
    if (!members.length) return;
    const bySubject = members.map((member) => {
      const tuple = groupMemberTuple(groupId, member);
      return and(
        eq(relationTuples.subjectType, tuple.subjectType),
        eq(relationTuples.subjectId, tuple.subjectId),
        eq(relationTuples.subjectRelation, tuple.subjectRelation ?? ''),
      );
    });
    await tx.delete(relationTuples).where(and(membersOf(groupId), or(...bySubject)));
  }

  /** 直接成員的主體（含已刪除的使用者與群組；稽核的 before／after 用）。 */
  async listMemberRefs(groupId: string, tx: DbOrTx): Promise<GroupMemberSubject[]> {
    const rows = await tx
      .select({ type: relationTuples.subjectType, id: relationTuples.subjectId })
      .from(relationTuples)
      .where(membersOf(groupId))
      .orderBy(asc(relationTuples.subjectType), asc(relationTuples.subjectId));
    return rows.map((row) => ({
      type: row.type === GROUP_OBJECT_TYPE ? 'group' : 'user',
      id: row.id,
    }));
  }

  // ── 群組持有的角色 ───────────────────────────────────

  /** 群組持有的角色（未刪除的）。呼叫端先確認群組未刪除。 */
  async listRoles(groupId: string, db: DbOrTx = this.db) {
    return db
      .select({ id: roles.id, slug: roles.slug, name: roles.name, isSystem: roles.isSystem })
      .from(relationTuples)
      .innerJoin(roles, and(eq(sql`${roles.id}::text`, relationTuples.objectId), isActiveRole()))
      .where(rolesOf(groupId))
      .orderBy(asc(roles.name));
  }

  /** 群組持有的角色 id（含已刪除的角色；稽核的 before／after 用）。 */
  async listRoleIds(groupId: string, tx: DbOrTx): Promise<string[]> {
    const rows = await tx
      .select({ roleId: relationTuples.objectId })
      .from(relationTuples)
      .where(rolesOf(groupId))
      .orderBy(asc(relationTuples.objectId));
    return rows.map((row) => row.roleId);
  }

  async addRoles(
    groupId: string,
    roleIds: readonly string[],
    actorId: string,
    tx: DbOrTx,
  ): Promise<void> {
    if (!roleIds.length) return;
    await tx
      .insert(relationTuples)
      .values(roleIds.map((roleId) => groupRoleTuple(roleId, groupId, actorId)))
      .onConflictDoNothing();
  }

  async removeRoles(groupId: string, roleIds: readonly string[], tx: DbOrTx): Promise<void> {
    if (!roleIds.length) return;
    await tx
      .delete(relationTuples)
      .where(and(rolesOf(groupId), inArray(relationTuples.objectId, [...roleIds])));
  }

  // ── 結構（巢狀）：只沿未刪除的群組走 ──────────────────

  /**
   * 包含這個群組的群組（直接或間接），每個帶「往上第幾層」（直接的上層是 1）。不含自己。
   * 邊：`group:<上層>#member@group:<下層>#member`。
   */
  async ancestors(groupId: string, tx: DbOrTx): Promise<Array<{ id: string; depth: number }>> {
    const rows = await tx.execute<{ id: string; depth: number }>(sql`
      WITH RECURSIVE up(id, depth) AS (
        SELECT ${groupId}::text, 0
        UNION
        SELECT t.object_id, up.depth + 1
        FROM ${relationTuples} t JOIN up
          ON t.subject_type = ${GROUP_OBJECT_TYPE} AND t.subject_id = up.id
          AND t.subject_relation = ${GROUP_MEMBER_RELATION}
        WHERE t.object_type = ${GROUP_OBJECT_TYPE} AND t.relation = ${GROUP_MEMBER_RELATION}
          AND up.depth < 32
          AND EXISTS (SELECT 1 FROM groups g WHERE g.id::text = t.object_id AND g.deleted_at IS NULL /* notDeleted */)
      )
      SELECT id, max(depth)::int AS depth FROM up WHERE id <> ${groupId}::text GROUP BY id`);
    return [...rows];
  }

  /**
   * 這個群組底下的群組（直接或間接的成員群組），每個帶「往下第幾層」（直接的成員群組是 1）。不含自己。
   */
  async descendants(groupId: string, tx: DbOrTx): Promise<Array<{ id: string; depth: number }>> {
    const rows = await tx.execute<{ id: string; depth: number }>(sql`
      WITH RECURSIVE down(id, depth) AS (
        SELECT ${groupId}::text, 0
        UNION
        SELECT t.subject_id, down.depth + 1
        FROM ${relationTuples} t JOIN down
          ON t.object_type = ${GROUP_OBJECT_TYPE} AND t.object_id = down.id AND t.relation = ${GROUP_MEMBER_RELATION}
        WHERE t.subject_type = ${GROUP_OBJECT_TYPE} AND t.subject_relation = ${GROUP_MEMBER_RELATION}
          AND down.depth < 32
          AND EXISTS (SELECT 1 FROM groups g WHERE g.id::text = t.subject_id AND g.deleted_at IS NULL /* notDeleted */)
      )
      SELECT id, max(depth)::int AS depth FROM down WHERE id <> ${groupId}::text GROUP BY id`);
    return [...rows];
  }

  /**
   * 群組（含巢狀群組）底下所有未刪除的使用者 id，去重。只用來推播與補建個人資料夾，不是權限的依據。
   * 已刪除的群組本身也可以查（還原、刪除時的受影響者）：起點不看是否刪除，往下只走未刪除的群組。
   */
  async memberUserIds(groupId: string, tx: DbOrTx = this.db): Promise<string[]> {
    const rows = await tx.execute<{ id: string }>(sql`
      WITH RECURSIVE down(id, depth) AS (
        SELECT ${groupId}::text, 0
        UNION
        SELECT t.subject_id, down.depth + 1
        FROM ${relationTuples} t JOIN down
          ON t.object_type = ${GROUP_OBJECT_TYPE} AND t.object_id = down.id AND t.relation = ${GROUP_MEMBER_RELATION}
        WHERE t.subject_type = ${GROUP_OBJECT_TYPE} AND t.subject_relation = ${GROUP_MEMBER_RELATION}
          AND down.depth < 32
          AND EXISTS (SELECT 1 FROM groups g WHERE g.id::text = t.subject_id AND g.deleted_at IS NULL /* notDeleted */)
      )
      SELECT DISTINCT t.subject_id AS id
      FROM ${relationTuples} t JOIN down ON t.object_id = down.id
      JOIN ${users} u ON u.id::text = t.subject_id AND u.deleted_at IS NULL /* notDeleted */
      WHERE t.object_type = ${GROUP_OBJECT_TYPE} AND t.relation = ${GROUP_MEMBER_RELATION}
        AND t.subject_type = ${USER_SUBJECT_TYPE} AND t.subject_relation = ''
      ORDER BY id`);
    return rows.map((row) => row.id);
  }

  // ── 存在性（加成員、加角色之前） ──────────────────────

  /** 這些 id 中未刪除的使用者。 */
  async findActiveUserIds(ids: readonly string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, [...ids]), notDeleted(users)));
    return rows.map((row) => row.id);
  }

  /** 這些 id 中未刪除的群組。 */
  async findActiveGroupIds(ids: readonly string[], tx: DbOrTx = this.db): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await tx
      .select({ id: groups.id })
      .from(groups)
      .where(and(inArray(groups.id, [...ids]), isActiveGroup()));
    return rows.map((row) => row.id);
  }

  /** 這些 id 中未刪除的角色（含 slug：判斷 super-admin，D12）。 */
  async findActiveRoles(ids: readonly string[]): Promise<Array<{ id: string; slug: string }>> {
    if (!ids.length) return [];
    return this.db
      .select({ id: roles.id, slug: roles.slug })
      .from(roles)
      .where(and(inArray(roles.id, [...ids]), isActiveRole()));
  }

  // ── 還原（ADR-0025 D2、D5）：這一段故意讀已刪除的列，一律用 isDeleted() ──

  async findDeletedById(id: string): Promise<GroupRow | undefined> {
    const [row] = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.id, id), isDeleted(groups)))
      .limit(1);
    return row;
  }

  /** 已刪除或未刪除都算：用來區分 404 與「沒有被刪除」。 */
  async exists(id: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.id, id))
      .limit(1);
    return Boolean(row);
  }

  /**
   * 清掉 `deleted_at`（只在仍是已刪除時）。保留的成員與持有角色的邊隨之生效，
   * revision 由 trigger（migration 0017）+1。`version` 不遞增（與角色的還原相同）。
   */
  async restore(id: string, actorId: string, tx: DbOrTx): Promise<GroupRow | undefined> {
    const [row] = await tx
      .update(groups)
      .set({ deletedAt: null, updatedBy: actorId })
      .where(and(eq(groups.id, id), isDeleted(groups)))
      .returning();
    return row;
  }
}
