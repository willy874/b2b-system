import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, containsPattern } from '@/core/database';
import type { RoleRow, UserInsert, UserRow, UserStatus } from '@/db/schema';
import { isActiveRole, roles, userRoles, users } from '@/db/schema';

import type { ListUserDto } from './dto/list-user.dto';

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
  if (status === 'locked') return or(eq(users.status, 'locked'), lockActive);
  if (status === 'active') {
    return and(
      eq(users.status, 'active'),
      or(isNull(users.lockedUntil), lte(users.lockedUntil, sql`now()`)),
    );
  }
  return eq(users.status, status);
}

/** 登入失敗後的計數與鎖定（`recordFailedLogin` 的結果）。 */
export interface FailedLoginResult {
  failedLoginCount: number;
  /** 這次失敗剛好達到上限時是鎖定的到期時間；否則 null。 */
  lockedUntil: Date | null;
}

@Injectable()
export class UserRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return row;
  }

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    return row;
  }

  async findByIdWithRoles(id: string): Promise<UserWithRoles | undefined> {
    const [row] = await this.db
      .select({ user: users, roles: ROLE_AGGREGATE })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, and(eq(roles.id, userRoles.roleId), isActiveRole()))
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .groupBy(users.id)
      .limit(1);
    return row ? { ...row.user, roles: row.roles } : undefined;
  }

  private buildFilters(query: ListUserDto): SQL | undefined {
    const conditions: SQL[] = [isNull(users.deletedAt)];
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
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${userRoles} ur WHERE ur.user_id = ${users.id} AND ur.role_id IN ${query.roleId})`,
      );
    }
    return and(...conditions);
  }

  async list(query: ListUserDto): Promise<{ items: UserWithRoles[]; total: number }> {
    const where = this.buildFilters(query);
    // 依 sort 陣列的順序排；最後以 id 收尾，讓同值的列在分頁之間順序穩定
    const orderBy = query.sort.map(({ sort, order }) =>
      order === 'asc' ? asc(SORT_COLUMNS[sort]) : desc(SORT_COLUMNS[sort]),
    );

    const [rows, [counted]] = await Promise.all([
      this.db
        .select({ user: users, roles: ROLE_AGGREGATE })
        .from(users)
        .leftJoin(userRoles, eq(userRoles.userId, users.id))
        .leftJoin(roles, and(eq(roles.id, userRoles.roleId), isActiveRole()))
        .where(where)
        .groupBy(users.id)
        .orderBy(...orderBy, desc(users.id))
        .limit(query.limit)
        .offset(query.offset),
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

  async update(id: string, values: Partial<UserInsert>, tx?: DbOrTx): Promise<UserRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db.update(users).set(values).where(eq(users.id, id)).returning();
    return row;
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
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isActiveRole()))
      .where(eq(userRoles.userId, userId))
      .orderBy(asc(roles.slug));
    return rows;
  }

  /** 整批取代語意（PUT /users/:id/roles）。 */
  async replaceRoles(
    userId: string,
    roleIds: readonly string[],
    actorId: string | null,
    tx: DbOrTx,
  ): Promise<void> {
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
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
      .insert(userRoles)
      .values(active.map(({ id: roleId }) => ({ userId, roleId, grantedBy: actorId })))
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
      .select({ id: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isActiveRole()))
      .where(and(eq(userRoles.userId, userId), eq(roles.slug, slug)))
      .limit(1);
    return row !== undefined;
  }

  /**
   * 交易層級的 advisory lock：所有「可能減少 super-admin」的寫入（停用、刪除、拔角色）在交易內先取得它，
   * 再計數、再寫入，兩個並行的操作就不會同時看到「還剩一位」（docs/rbac/01-domain-model.md I8）。
   * 交易結束自動釋放；每個租戶是自己的 database，不會跨租戶互鎖。
   */
  async lockSuperAdminGuard(tx: DbOrTx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('super_admin_guard'))`);
  }

  /** 鎖住使用者列直到交易結束（整批取代角色時序列化同一個人的並行修改）。 */
  async lockForUpdate(userId: string, tx: DbOrTx): Promise<void> {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
  }

  /** 只算 active 且未刪除的持有者——全部停用一樣會讓系統無人可管。 */
  async countActiveUsersByRoleSlug(
    slug: string,
    excludeUserId?: string,
    tx?: DbOrTx,
  ): Promise<number> {
    const conditions: SQL[] = [
      eq(roles.slug, slug),
      isActiveRole(),
      isNull(users.deletedAt),
      eq(users.status, 'active'),
    ];
    if (excludeUserId) conditions.push(sql`${users.id} <> ${excludeUserId}`);
    const [row] = await (tx ?? this.db)
      .select({ total: sql<number>`count(distinct ${users.id})::int` })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(...conditions));
    return row?.total ?? 0;
  }
}
