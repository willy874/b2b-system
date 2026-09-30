import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, like, sql } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, containsPattern, prefixPattern } from '@/core/database';
import type { PermissionRow, RoleInsert, RoleRow } from '@/db/schema';
import { permissions, rolePermissions, roles, userRoles, users } from '@/db/schema';

import type { ListRoleDto } from './dto/list-role.dto';

export interface RoleWithCounts extends RoleRow {
  permissionCount: number;
  userCount: number;
}

const permissionCountOf = (roleId: SQLWrapper | string) =>
  sql<number>`(SELECT count(*)::int FROM ${rolePermissions} rp WHERE rp.role_id = ${roleId})`;

// 軟刪除使用者不會清掉 user_roles，計數要排除已刪除的使用者（與 listUsers 一致）
const userCountOf = (roleId: SQLWrapper | string) =>
  sql<number>`(SELECT count(*)::int FROM ${userRoles} ur INNER JOIN ${users} u ON u.id = ur.user_id WHERE ur.role_id = ${roleId} AND u.deleted_at IS NULL)`;

// 單表 select 時 Drizzle 會把 ${roles.id} 輸出成不帶表名的 "id"，在子查詢裡會被解析成 users.id；
// 明確寫出表名才會關聯到外層的角色
const OUTER_ROLE_ID = sql`${roles}.${sql.identifier(roles.id.name)}`;

// 按數量排序時每個符合條件的角色都要先算完子查詢才能排；兩個子查詢都走 role_id 開頭的索引，
// 角色數量級（數十～數百）下成本可忽略。user_roles 成長到百萬級再考慮反正規化成計數欄位。
const SORT_COLUMNS = {
  createdAt: roles.createdAt,
  name: roles.name,
  slug: roles.slug,
  permissionCount: permissionCountOf(OUTER_ROLE_ID),
  userCount: userCountOf(OUTER_ROLE_ID),
} as const;

@Injectable()
export class RoleRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async findById(id: string): Promise<RoleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), isNull(roles.deletedAt)))
      .limit(1);
    return row;
  }

  async findBySlug(slug: string): Promise<RoleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.slug, slug), isNull(roles.deletedAt)))
      .limit(1);
    return row;
  }

  /** 名稱不分大小寫（與唯一索引 `roles_name_key` 的 `lower(name)` 一致）。 */
  async findByName(name: string): Promise<RoleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(and(sql`lower(${roles.name}) = lower(${name})`, isNull(roles.deletedAt)))
      .limit(1);
    return row;
  }

  async findSlugsLike(prefix: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: roles.slug })
      .from(roles)
      .where(and(like(roles.slug, prefixPattern(prefix)), isNull(roles.deletedAt)));
    return rows.map((row) => row.slug);
  }

  async withCounts(id: string): Promise<RoleWithCounts | undefined> {
    const role = await this.findById(id);
    if (!role) return undefined;
    const [counts] = await this.db
      .select({
        permissionCount: permissionCountOf(id),
        userCount: userCountOf(id),
      })
      .from(roles)
      .where(eq(roles.id, id))
      .limit(1);
    return {
      ...role,
      permissionCount: counts?.permissionCount ?? 0,
      userCount: counts?.userCount ?? 0,
    };
  }

  async list(query: ListRoleDto): Promise<{ items: RoleWithCounts[]; total: number }> {
    const conditions: SQL[] = [isNull(roles.deletedAt)];
    if (query.keyword) {
      const pattern = containsPattern(query.keyword);
      conditions.push(sql`(${roles.name} ILIKE ${pattern} OR ${roles.slug} ILIKE ${pattern})`);
    }
    if (query.isSystem !== undefined) conditions.push(eq(roles.isSystem, query.isSystem));
    const where = and(...conditions);
    // 依 sort 陣列的順序排；最後以 id 收尾，讓同值的列在分頁之間順序穩定
    const orderBy = query.sort.map(({ sort, order }) =>
      order === 'asc' ? asc(SORT_COLUMNS[sort]) : desc(SORT_COLUMNS[sort]),
    );

    const [items, [counted]] = await Promise.all([
      this.db
        .select({
          role: roles,
          permissionCount: SORT_COLUMNS.permissionCount,
          userCount: SORT_COLUMNS.userCount,
        })
        .from(roles)
        .where(where)
        .orderBy(...orderBy, desc(roles.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(roles)
        .where(where),
    ]);

    return {
      items: items.map((row) => ({
        ...row.role,
        permissionCount: row.permissionCount,
        userCount: row.userCount,
      })),
      total: counted?.total ?? 0,
    };
  }

  async create(values: RoleInsert, tx?: DbOrTx): Promise<RoleRow> {
    const db = tx ?? this.db;
    const [row] = await db.insert(roles).values(values).returning();
    if (!row) throw new Error('建立角色失敗');
    return row;
  }

  async update(id: string, values: Partial<RoleInsert>, tx?: DbOrTx): Promise<RoleRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db.update(roles).set(values).where(eq(roles.id, id)).returning();
    return row;
  }

  /** 在交易內以 `FOR UPDATE` 鎖住未刪除的角色列；不存在（或已刪除）時回 false。 */
  async lockActive(id: string, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, id), isNull(roles.deletedAt)))
      .for('update');
    return Boolean(row);
  }

  /** 軟刪除角色並刪掉它的指派；回傳被刪掉指派的使用者（刪除與取得在同一條語句）。 */
  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<string[]> {
    await tx
      .update(roles)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(eq(roles.id, id));
    const removed = await tx
      .delete(userRoles)
      .where(eq(userRoles.roleId, id))
      .returning({ userId: userRoles.userId });
    return removed.map((row) => row.userId);
  }

  async listPermissions(roleId: string, db: DbOrTx = this.db): Promise<PermissionRow[]> {
    return db
      .select({
        id: permissions.id,
        key: permissions.key,
        resource: permissions.resource,
        action: permissions.action,
        nameI18nKey: permissions.nameI18nKey,
        description: permissions.description,
        sortOrder: permissions.sortOrder,
        createdAt: permissions.createdAt,
      })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, roleId))
      .orderBy(asc(permissions.sortOrder));
  }

  async listPermissionKeys(roleId: string, db: DbOrTx = this.db): Promise<string[]> {
    const rows = await this.listPermissions(roleId, db);
    return rows.map((row) => row.key);
  }

  async addPermissions(
    roleId: string,
    permissionIds: readonly string[],
    actorId: string | null,
    tx: DbOrTx,
  ): Promise<void> {
    if (!permissionIds.length) return;
    await tx
      .insert(rolePermissions)
      .values(permissionIds.map((permissionId) => ({ roleId, permissionId, grantedBy: actorId })))
      .onConflictDoNothing();
  }

  async removePermissions(
    roleId: string,
    permissionIds: readonly string[],
    tx: DbOrTx,
  ): Promise<void> {
    if (!permissionIds.length) return;
    await tx
      .delete(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, roleId),
          inArray(rolePermissions.permissionId, [...permissionIds]),
        ),
      );
  }

  async countUsers(roleId: string, db: DbOrTx = this.db): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(userRoles)
      .innerJoin(users, and(eq(users.id, userRoles.userId), isNull(users.deletedAt)))
      .where(eq(userRoles.roleId, roleId));
    return row?.total ?? 0;
  }

  async listUsers(roleId: string, offset: number, limit: number) {
    const [items, [counted]] = await Promise.all([
      this.db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          status: users.status,
        })
        .from(userRoles)
        .innerJoin(users, and(eq(users.id, userRoles.userId), isNull(users.deletedAt)))
        .where(eq(userRoles.roleId, roleId))
        .orderBy(asc(users.email))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(userRoles)
        .innerJoin(users, and(eq(users.id, userRoles.userId), isNull(users.deletedAt)))
        .where(eq(userRoles.roleId, roleId)),
    ]);
    return { items, total: counted?.total ?? 0 };
  }

  async searchByName(keyword: string): Promise<RoleRow[]> {
    return this.db
      .select()
      .from(roles)
      .where(and(ilike(roles.name, prefixPattern(keyword)), isNull(roles.deletedAt)));
  }
}
