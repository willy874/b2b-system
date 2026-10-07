import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, containsPattern } from '@/core/database';
import { RESOURCE_TYPE } from '@/core/resource';
import type { RoleRow, UserInsert, UserRow, UserStatus } from '@/db/schema';
import {
  fileFolders,
  groups,
  hasAnyTag,
  isActiveGroup,
  isActiveRole,
  isDeleted,
  isGroupMemberTuple,
  isHumanUser,
  isRoleHolderTuple,
  notDeleted,
  relationTuples,
  ROLE_HOLDER_RELATION,
  ROLE_OBJECT_TYPE,
  roleHolderTuple,
  roles,
  USER_SUBJECT_TYPE,
  users,
} from '@/db/schema';

import type { ListUserDto } from './dto/list-user.dto';

/** 回收桶的一列（`listDeleted`）；刪除者取自刪除時寫入的 `updated_by`（刪除之後不再有人更新這一列）。 */
export interface DeletedUserRow {
  id: string;
  email: string;
  displayName: string;
  deletedAt: Date;
  deletedBy: { id: string; name: string } | null;
}

/** 刪除者：同一張 `users` 的別名（刪除者本人也可能已被刪除，仍顯示名字）。 */
const deleter = alias(users, 'deleter');

export interface UserRoleSummary {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
}

export interface UserWithRoles extends UserRow {
  roles: UserRoleSummary[];
}

const ROLE_AGGREGATE = sql<UserRoleSummary[]>`
  COALESCE(
    json_agg(
      json_build_object('id', ${roles.id}, 'slug', ${roles.slug}, 'name', ${roles.name}, 'isSystem', ${roles.isSystem})
      ORDER BY ${roles.slug}
    ) FILTER (WHERE ${roles.id} IS NOT NULL),
    '[]'
  )`;

/** 使用者 ⋈ 持有角色的邊（`role:<r>#holder@user:<users.id>`）。 */
const HELD_BY_USER = and(isRoleHolderTuple(), eq(relationTuples.subjectId, sql`${users.id}::text`));
/** 邊 ⋈ 未刪除的角色。 */
const HELD_ROLE = and(eq(sql`${roles.id}::text`, relationTuples.objectId), isActiveRole());

const SORT_COLUMNS = {
  createdAt: users.createdAt,
  email: users.email,
  displayName: users.displayName,
  lastLoginAt: users.lastLoginAt,
} as const;

/**
 * 列表以「顯示的狀態」篩選（docs/architecture/backend/04-auth.md §3.3）：登入失敗的自動鎖定只寫 `locked_until`、
 * 不改 `status`，所以「鎖定中」是 `locked_until` 還沒到期，`active` 要排除鎖定中的人。
 */
function statusCondition(status: UserStatus): SQL | undefined {
  const lockActive = gt(users.lockedUntil, sql`now()`);
  if (status === 'locked') return and(eq(users.status, 'active'), lockActive);
  if (status === 'active') {
    return and(
      eq(users.status, 'active'),
      or(isNull(users.lockedUntil), lte(users.lockedUntil, sql`now()`)),
    );
  }
  return eq(users.status, status);
}

/** `update()` 的樂觀鎖選項。 */
export interface VersionedUpdate {
  /** 只在目前的 `version` 等於它時更新（樂觀鎖）。 */
  expectedVersion?: number;
  /** 一併把 `version` 加一：寫入了實體自己的可編輯欄位時才帶（`USER_VERSIONED_FIELDS`）。 */
  bumpVersion?: boolean;
}

/** 登入失敗後的計數與鎖定（`recordFailedLogin` 的結果）。 */
export interface FailedLoginResult {
  failedLoginCount: number;
  /** 這次失敗剛好達到上限時是鎖定的到期時間；否則 null。 */
  lockedUntil: Date | null;
}

/** 這位使用者持有角色的邊。 */
function heldBy(userId: string): SQL | undefined {
  return and(isRoleHolderTuple(), eq(relationTuples.subjectId, userId));
}

@Injectable()
export class UserRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), notDeleted(users), isHumanUser()))
      .limit(1);
    return row;
  }

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, email), notDeleted(users), isHumanUser()))
      .limit(1);
    return row;
  }

  async findByIdWithRoles(id: string): Promise<UserWithRoles | undefined> {
    const [row] = await this.db
      .select({ user: users, roles: ROLE_AGGREGATE })
      .from(users)
      .leftJoin(relationTuples, HELD_BY_USER)
      .leftJoin(roles, HELD_ROLE)
      .where(and(eq(users.id, id), notDeleted(users), isHumanUser()))
      .groupBy(users.id)
      .limit(1);
    return row ? { ...row.user, roles: row.roles } : undefined;
  }

  private buildFilters(query: ListUserDto): SQL | undefined {
    // 服務帳號有自己的列表（modules/service-account）
    const conditions: SQL[] = [notDeleted(users), isHumanUser()];
    if (query.keyword) {
      // 三個運算式與 pg_trgm 的 GIN 索引（users_*_trgm_idx）一致才用得上索引
      const pattern = containsPattern(query.keyword);
      const matched = or(
        ilike(sql`${users.email}::text`, pattern),
        ilike(sql`${users.username}::text`, pattern),
        ilike(users.displayName, pattern),
      );
      if (matched) conditions.push(matched);
    }
    if (query.status?.length) {
      const matched = or(...query.status.map((status) => statusCondition(status)));
      if (matched) conditions.push(matched);
    }
    if (query.roleId?.length) {
      // 已刪除的角色保留持有者邊（docs/architecture/backend/14-revisions.md §9.2 D2）：只認未刪除的角色，否則以刪除的角色篩選會列出它休眠的持有者。
      // 子查詢用別名手寫條件：計數的查詢是單表 select，Drizzle 會把 ${roles.id} 輸出成不帶表名的 "id"
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${relationTuples} t
          INNER JOIN ${roles} r ON r.id::text = t.object_id AND r.deleted_at IS NULL /* notDeleted */
          WHERE t.object_type = ${ROLE_OBJECT_TYPE} AND t.relation = ${ROLE_HOLDER_RELATION}
            AND t.subject_type = ${USER_SUBJECT_TYPE} AND t.subject_relation = ''
            AND t.subject_id = ${users.id}::text AND t.object_id IN ${query.roleId})`,
      );
    }
    if (query.tagId?.length) {
      conditions.push(hasAnyTag(RESOURCE_TYPE.USER, users.id, query.tagId));
    }
    return and(...conditions);
  }

  async list(query: ListUserDto): Promise<{ items: UserWithRoles[]; total: number }> {
    const where = this.buildFilters(query);
    // 依 sort 陣列的順序排；最後以 id 收尾，讓同值的列在分頁之間順序穩定
    const orderBy = query.sort.map(({ sort, order }) =>
      order === 'asc' ? asc(SORT_COLUMNS[sort]) : desc(SORT_COLUMNS[sort]),
    );

    // 先在 users 上排序、分頁，只對這一頁的人 join 角色並聚合：聚合不必涵蓋 offset 之前的每一個人
    // （排序欄都在 users 上，篩選的角色條件是 EXISTS，不需要先聚合）
    const page = this.db
      .select({ id: users.id })
      .from(users)
      .where(where)
      .orderBy(...orderBy, desc(users.id))
      .limit(query.limit)
      .offset(query.offset)
      .as('page');
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({ user: users, roles: ROLE_AGGREGATE })
        .from(page)
        .innerJoin(users, eq(users.id, page.id))
        .leftJoin(relationTuples, HELD_BY_USER)
        .leftJoin(roles, HELD_ROLE)
        .groupBy(users.id)
        .orderBy(...orderBy, desc(users.id)),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(users)
        .where(where),
    ]);

    return {
      items: rows.map((row) => ({ ...row.user, roles: row.roles })),
      total: counted?.total ?? 0,
    };
  }

  async create(values: UserInsert, tx?: DbOrTx): Promise<UserRow> {
    const db = tx ?? this.db;
    const [row] = await db.insert(users).values(values).returning();
    if (!row) throw new Error('建立使用者失敗');
    return row;
  }

  /**
   * `bumpVersion`：一併遞增樂觀鎖的 `version`。帶 `expectedVersion` 時只在版本相符、且未刪除時才更新
   * （比對與寫入在同一個 UPDATE，沒有「讀到之後被搶先寫入」的空窗）；不符回 undefined。
   */
  async update(
    id: string,
    values: Partial<UserInsert>,
    tx?: DbOrTx,
    options: VersionedUpdate = {},
  ): Promise<UserRow | undefined> {
    const db = tx ?? this.db;
    const conditions = [eq(users.id, id)];
    if (options.expectedVersion !== undefined) {
      conditions.push(eq(users.version, options.expectedVersion), notDeleted(users));
    }
    const [row] = await db
      .update(users)
      .set(options.bumpVersion ? { ...values, version: sql`${users.version} + 1` } : values)
      .where(and(...conditions))
      .returning();
    return row;
  }

  /** 未刪除的使用者目前的 `version`；不存在或已刪除回 undefined（樂觀鎖衝突時重讀）。 */
  async findVersion(id: string, tx?: DbOrTx): Promise<number | undefined> {
    const [row] = await (tx ?? this.db)
      .select({ version: users.version })
      .from(users)
      .where(and(eq(users.id, id), notDeleted(users), isHumanUser()))
      .limit(1);
    return row?.version;
  }

  async softDelete(id: string, actorId: string, tx?: DbOrTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(users)
      .set({
        deletedAt: new Date(),
        updatedBy: actorId,
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(eq(users.id, id));
  }

  /**
   * 登入失敗：**原子地** 遞增失敗次數（併發的錯誤密碼每一次都算數），達到 `maxAttempts` 時寫入鎖定到期時間。
   * 上一次的鎖定已過期時從 1 重新計算（否則到期後再錯一次就立刻重鎖）。鎖定中不更新：回傳 undefined，
   * 鎖定期間的失敗不延長鎖定（docs/architecture/backend/04-auth.md §3.3）。
   */
  async recordFailedLogin(
    id: string,
    maxAttempts: number,
    lockoutSeconds: number,
  ): Promise<FailedLoginResult | undefined> {
    const lockExpired = sql`(${users.lockedUntil} IS NOT NULL AND ${users.lockedUntil} <= now())`;
    const nextCount = sql`(CASE WHEN ${lockExpired} THEN 1 ELSE ${users.failedLoginCount} + 1 END)`;
    const [row] = await this.db
      .update(users)
      .set({
        failedLoginCount: sql`${nextCount}`,
        lockedUntil: sql`CASE WHEN ${nextCount} >= ${maxAttempts}::int
          THEN now() + make_interval(secs => ${lockoutSeconds}::int) ELSE NULL END`,
      })
      .where(
        and(eq(users.id, id), or(isNull(users.lockedUntil), lte(users.lockedUntil, sql`now()`))),
      )
      .returning({ failedLoginCount: users.failedLoginCount, lockedUntil: users.lockedUntil });
    return row;
  }

  async incrementTokenVersion(id: string, tx?: DbOrTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id));
  }

  async listRoles(userId: string, tx?: DbOrTx): Promise<UserRoleSummary[]> {
    const rows = await (tx ?? this.db)
      .select({ id: roles.id, slug: roles.slug, name: roles.name, isSystem: roles.isSystem })
      .from(relationTuples)
      .innerJoin(roles, HELD_ROLE)
      .where(heldBy(userId))
      .orderBy(asc(roles.slug));
    return rows;
  }

  /**
   * 他 **直接** 所屬的（未刪除的）群組：`group:<g>#member@user:<id>`，未過期的邊。上層群組與群組持有的角色由引擎沿閉包展開
   * （`PermissionService.assertCanGrant`）。刪除使用者不刪這些邊（永久刪除時才刪），還原或重新啟用時它們跟著生效。
   */
  async listGroupIds(userId: string, tx?: DbOrTx): Promise<string[]> {
    const rows = await (tx ?? this.db)
      .select({ id: groups.id })
      .from(relationTuples)
      .innerJoin(groups, and(eq(sql`${groups.id}::text`, relationTuples.objectId), isActiveGroup()))
      .where(
        and(
          isGroupMemberTuple(),
          eq(relationTuples.subjectType, USER_SUBJECT_TYPE),
          eq(relationTuples.subjectId, userId),
          eq(relationTuples.subjectRelation, ''),
          or(isNull(relationTuples.expiresAt), gt(relationTuples.expiresAt, new Date())),
        ),
      )
      .orderBy(asc(groups.id));
    return rows.map((row) => row.id);
  }

  /**
   * 整批取代語意（PUT /users/:id/roles）。只刪 **未刪除角色** 的持有者邊：已刪除角色的邊是休眠的
   * （讀取時被排除），留著讓角色還原時這個人一起回來；否則改一次某人的角色就會把它們一起清掉
   * （docs/architecture/backend/14-revisions.md §9.2 D2 ①）。
   */
  async replaceRoles(
    userId: string,
    roleIds: readonly string[],
    actorId: string | null,
    tx: DbOrTx,
  ): Promise<void> {
    const activeRoleIds = tx
      .select({ id: sql`${roles.id}::text` })
      .from(roles)
      .where(isActiveRole());
    await tx
      .delete(relationTuples)
      .where(and(heldBy(userId), inArray(relationTuples.objectId, activeRoleIds)));
    await this.insertActiveRoles(userId, roleIds, actorId, tx);
  }

  async assignRoles(
    userId: string,
    roleIds: readonly string[],
    actorId: string | null,
    tx: DbOrTx,
  ): Promise<void> {
    await this.insertActiveRoles(userId, roleIds, actorId, tx);
  }

  /**
   * 只插入仍未刪除的角色，並以 `FOR SHARE` 鎖住角色列到交易結束：
   * 併發的刪除角色（`FOR UPDATE`）若先拿到鎖，這裡等它提交後重新判斷、看到 `deleted_at` 而略過，
   * 不會留下指向已刪除角色的指派；若這裡先拿到鎖，刪除要等指派提交，重新計數時就算得到這個人。
   */
  private async insertActiveRoles(
    userId: string,
    roleIds: readonly string[],
    actorId: string | null,
    tx: DbOrTx,
  ): Promise<void> {
    if (!roleIds.length) return;
    const active = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(inArray(roles.id, [...new Set(roleIds)]), isActiveRole()))
      .for('share');
    if (!active.length) return;
    await tx
      .insert(relationTuples)
      .values(active.map(({ id: roleId }) => roleHolderTuple(roleId, userId, actorId)))
      .onConflictDoNothing();
  }

  async findActiveRolesByIds(roleIds: readonly string[]): Promise<RoleRow[]> {
    if (!roleIds.length) return [];
    return this.db
      .select()
      .from(roles)
      .where(and(inArray(roles.id, [...roleIds]), isActiveRole()));
  }

  /** 使用者（未刪除）是否持有某個（未刪除的）角色；直接查 DB，不經權限快取。 */
  async hasRoleSlug(userId: string, slug: string, tx?: DbOrTx): Promise<boolean> {
    const [row] = await (tx ?? this.db)
      .select({ id: relationTuples.subjectId })
      .from(relationTuples)
      .innerJoin(roles, HELD_ROLE)
      .where(and(heldBy(userId), eq(roles.slug, slug)))
      .limit(1);
    return row !== undefined;
  }

  /**
   * 交易層級的 advisory lock：所有「可能減少 super-admin」的寫入（停用、刪除、拔角色）在交易內先取得它，
   * 再計數、再寫入，兩個並行的操作就不會同時看到「還剩一位」（docs/architecture/iam/01-model.md I8）。
   * 交易結束自動釋放；每個租戶是自己的 database，不會跨租戶互鎖。
   */
  async lockSuperAdminGuard(tx: DbOrTx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('super_admin_guard'))`);
  }

  /** 鎖住使用者列直到交易結束（整批取代角色時序列化同一個人的並行修改）。 */
  async lockForUpdate(userId: string, tx: DbOrTx): Promise<void> {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  }

  /**
   * 只算 active、未刪除的 **人**——全部停用一樣會讓系統無人可管；持有 super-admin 的服務帳號不能登入管理，不算數
   * （docs/architecture/06-external-api.md §9.2 D1）。
   */
  async countActiveUsersByRoleSlug(
    slug: string,
    excludeUserId?: string,
    tx?: DbOrTx,
  ): Promise<number> {
    const conditions: SQL[] = [
      eq(roles.slug, slug),
      isActiveRole(),
      notDeleted(users),
      isHumanUser(),
      eq(users.status, 'active'),
    ];
    if (excludeUserId) conditions.push(sql`${users.id} <> ${excludeUserId}`);
    const [row] = await (tx ?? this.db)
      .select({ total: sql<number>`count(distinct ${users.id})::int` })
      .from(relationTuples)
      .innerJoin(roles, eq(sql`${roles.id}::text`, relationTuples.objectId))
      .innerJoin(users, eq(sql`${users.id}::text`, relationTuples.subjectId))
      .where(and(isRoleHolderTuple(), ...conditions));
    return row?.total ?? 0;
  }

  // ── 回收桶與還原（docs/architecture/backend/14-revisions.md §9.2 D6、D9、D11）：這一段故意讀已刪除的列，一律用 isDeleted() ──

  /** 已刪除的使用者；不存在或沒有被刪除回 undefined。服務帳號不能還原（不進回收桶）。 */
  async findDeletedById(id: string, tx?: DbOrTx): Promise<UserRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(users)
      .where(and(eq(users.id, id), isDeleted(users), isHumanUser()))
      .limit(1);
    return row;
  }

  /** 未刪除、username 相同（不分大小寫，citext）的帳號：改名與還原前找佔用者。 */
  async findByUsername(username: string, tx?: DbOrTx): Promise<UserRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(users)
      .where(and(eq(users.username, username), notDeleted(users)))
      .limit(1);
    return row;
  }

  /**
   * 清掉 `deleted_at`（只在仍是已刪除時；並行的兩個還原只有一個命中）。`status`、`token_version` 維持刪除時的值；
   * `version` 不遞增——與刪除一樣不是編輯實體的欄位（docs/architecture/backend/03-api-conventions.md §11）。
   */
  async restore(id: string, actorId: string, tx: DbOrTx): Promise<UserRow | undefined> {
    const [row] = await tx
      .update(users)
      .set({ deletedAt: null, updatedBy: actorId })
      .where(and(eq(users.id, id), isDeleted(users)))
      .returning();
    return row;
  }

  async listDeleted(query: {
    offset: number;
    limit: number;
    keyword?: string;
  }): Promise<{ items: DeletedUserRow[]; total: number }> {
    // 回收桶只列人：刪除的服務帳號不能還原，保留期滿後仍由 findExpired 一起清除
    const conditions: SQL[] = [isDeleted(users), isHumanUser()];
    if (query.keyword) {
      const pattern = containsPattern(query.keyword);
      const matched = or(
        ilike(sql`${users.email}::text`, pattern),
        ilike(users.displayName, pattern),
      );
      if (matched) conditions.push(matched);
    }
    const where = and(...conditions);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          deletedAt: users.deletedAt,
          deleterId: deleter.id,
          deleterName: deleter.displayName,
        })
        .from(users)
        .leftJoin(deleter, eq(deleter.id, users.updatedBy))
        .where(where)
        .orderBy(desc(users.deletedAt), desc(users.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(users)
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
   * 刪除超過保留期限、可以永久刪除的使用者（依 id 的 keyset）。還擁有資料夾（`file_folders.owner_id` 是
   * `ON DELETE RESTRICT`，含已軟刪除、尚未永久刪除的個人資料夾）的人這一輪不取：等資料夾先被清掉（docs/architecture/backend/14-revisions.md §9.2 D11）。
   */
  async findExpired(
    cutoff: Date,
    afterId: string | null,
    limit: number,
  ): Promise<Array<{ id: string; email: string; deletedAt: Date }>> {
    const rows = await this.db
      .select({ id: users.id, email: users.email, deletedAt: users.deletedAt })
      .from(users)
      .where(
        and(
          isDeleted(users),
          lt(users.deletedAt, cutoff),
          afterId ? gt(users.id, afterId) : undefined,
          sql`NOT EXISTS (SELECT 1 FROM ${fileFolders} WHERE ${fileFolders.ownerId} = ${users.id})`,
        ),
      )
      .orderBy(asc(users.id))
      .limit(limit);
    return rows.flatMap(({ deletedAt, ...row }) => (deletedAt ? [{ ...row, deletedAt }] : []));
  }

  /**
   * 永久刪除一位已刪除的使用者（在呼叫端的交易內）。連帶處理（docs/architecture/backend/13-trash.md §4.2）：
   * - 關係圖裡以他為主體或物件的邊（持有角色、資料夾授權）：多型沒有外鍵，要自己刪；
   * - `refresh_tokens`、`auth_tokens`、`user_identities` 由外鍵 `ON DELETE CASCADE` 刪除；
   * - 其他表的 `created_by`／`updated_by`、審批的申請人與審核者是 `SET NULL`；
   * - `file_folders.owner_id` 是 `RESTRICT`：`findExpired` 已排除，並行建立的由呼叫端的 savepoint 當作略過。
   * 回傳是否刪到（已被還原或已不在就是 false）。
   */
  async hardDelete(id: string, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .delete(users)
      .where(and(eq(users.id, id), isDeleted(users)))
      .returning({ id: users.id });
    if (!row) return false;
    await tx
      .delete(relationTuples)
      .where(
        or(
          and(eq(relationTuples.subjectType, USER_SUBJECT_TYPE), eq(relationTuples.subjectId, id)),
          and(eq(relationTuples.objectType, USER_SUBJECT_TYPE), eq(relationTuples.objectId, id)),
        ),
      );
    return true;
  }
}
