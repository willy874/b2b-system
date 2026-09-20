import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { RoleRow, UserInsert, UserRow } from '@/db/schema';
import { roles, userRoles, users } from '@/db/schema';

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

@Injectable()
export class UserRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

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
      .leftJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .groupBy(users.id)
      .limit(1);
    return row ? { ...row.user, roles: row.roles } : undefined;
  }

  private buildFilters(query: ListUserDto): SQL | undefined {
    const conditions: SQL[] = [isNull(users.deletedAt)];
    if (query.keyword) {
      const pattern = `%${query.keyword}%`;
      const matched = or(
        ilike(sql`${users.email}::text`, pattern),
        ilike(sql`coalesce(${users.username}::text, '')`, pattern),
        ilike(users.displayName, pattern),
      );
      if (matched) conditions.push(matched);
    }
    if (query.status?.length) conditions.push(inArray(users.status, query.status));
    if (query.roleId?.length) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${userRoles} ur WHERE ur.user_id = ${users.id} AND ur.role_id IN ${query.roleId})`,
      );
    }
    return and(...conditions);
  }

  async list(query: ListUserDto): Promise<{ items: UserWithRoles[]; total: number }> {
    const where = this.buildFilters(query);
    const column = SORT_COLUMNS[query.sortBy as keyof typeof SORT_COLUMNS];
    const direction = query.sortOrder === 'asc' ? asc(column) : desc(column);

    const [rows, [counted]] = await Promise.all([
      this.db
        .select({ user: users, roles: ROLE_AGGREGATE })
        .from(users)
        .leftJoin(userRoles, eq(userRoles.userId, users.id))
        .leftJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
        .where(where)
        .groupBy(users.id)
        .orderBy(direction, desc(users.id))
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

  async incrementTokenVersion(id: string, tx?: DbOrTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(users)
      .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
      .where(eq(users.id, id));
  }

  async listRoles(userId: string): Promise<UserRoleSummary[]> {
    const rows = await this.db
      .select({ id: roles.id, slug: roles.slug, name: roles.name, isSystem: roles.isSystem })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
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
    if (roleIds.length) {
      await tx
        .insert(userRoles)
        .values(roleIds.map((roleId) => ({ userId, roleId, grantedBy: actorId })));
    }
  }

  async assignRoles(
    userId: string,
    roleIds: readonly string[],
    actorId: string | null,
    tx: DbOrTx,
  ): Promise<void> {
    if (!roleIds.length) return;
    await tx
      .insert(userRoles)
      .values(roleIds.map((roleId) => ({ userId, roleId, grantedBy: actorId })))
      .onConflictDoNothing();
  }

  async findActiveRolesByIds(roleIds: readonly string[]): Promise<RoleRow[]> {
    if (!roleIds.length) return [];
    return this.db
      .select()
      .from(roles)
      .where(and(inArray(roles.id, [...roleIds]), isNull(roles.deletedAt)));
  }

  /** 只算 active 且未刪除的持有者——全部停用一樣會讓系統無人可管。 */
  async countActiveUsersByRoleSlug(slug: string, excludeUserId?: string): Promise<number> {
    const conditions: SQL[] = [
      eq(roles.slug, slug),
      isNull(roles.deletedAt),
      isNull(users.deletedAt),
      eq(users.status, 'active'),
    ];
    if (excludeUserId) conditions.push(sql`${users.id} <> ${excludeUserId}`);
    const [row] = await this.db
      .select({ total: sql<number>`count(distinct ${users.id})::int` })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(...conditions));
    return row?.total ?? 0;
  }
}
