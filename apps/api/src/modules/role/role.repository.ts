import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, like, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { PermissionRow, RoleInsert, RoleRow } from '@/db/schema';
import { permissions, rolePermissions, roles, userRoles, users } from '@/db/schema';

import type { ListRoleDto } from './dto/list-role.dto';

export interface RoleWithCounts extends RoleRow {
  permissionCount: number;
  userCount: number;
}

const SORT_COLUMNS = {
  createdAt: roles.createdAt,
  name: roles.name,
  slug: roles.slug,
} as const;

@Injectable()
export class RoleRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

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

  async findByName(name: string): Promise<RoleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.name, name), isNull(roles.deletedAt)))
      .limit(1);
    return row;
  }

  async findSlugsLike(prefix: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: roles.slug })
      .from(roles)
      .where(and(like(roles.slug, `${prefix}%`), isNull(roles.deletedAt)));
    return rows.map((row) => row.slug);
  }

  async withCounts(id: string): Promise<RoleWithCounts | undefined> {
    const role = await this.findById(id);
    if (!role) return undefined;
    const [counts] = await this.db
      .select({
        permissionCount: sql<number>`(SELECT count(*)::int FROM ${rolePermissions} rp WHERE rp.role_id = ${id})`,
        userCount: sql<number>`(SELECT count(*)::int FROM ${userRoles} ur WHERE ur.role_id = ${id})`,
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
      const pattern = `%${query.keyword}%`;
      conditions.push(sql`(${roles.name} ILIKE ${pattern} OR ${roles.slug} ILIKE ${pattern})`);
    }
    if (query.isSystem !== undefined) conditions.push(eq(roles.isSystem, query.isSystem));
    const where = and(...conditions);
    const column = SORT_COLUMNS[query.sortBy as keyof typeof SORT_COLUMNS];

    const [items, [counted]] = await Promise.all([
      this.db
        .select({
          role: roles,
          permissionCount: sql<number>`(SELECT count(*)::int FROM ${rolePermissions} rp WHERE rp.role_id = ${roles.id})`,
          userCount: sql<number>`(SELECT count(*)::int FROM ${userRoles} ur WHERE ur.role_id = ${roles.id})`,
        })
        .from(roles)
        .where(where)
        .orderBy(query.sortOrder === 'asc' ? asc(column) : desc(column))
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

  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(roles)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(eq(roles.id, id));
    await tx.delete(userRoles).where(eq(userRoles.roleId, id));
  }

  async listPermissions(roleId: string): Promise<PermissionRow[]> {
    return this.db
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

  async listPermissionKeys(roleId: string): Promise<string[]> {
    const rows = await this.listPermissions(roleId);
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

  async countUsers(roleId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(userRoles)
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

  async findUserIdsByRole(roleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId));
    return rows.map((row) => row.userId);
  }

  async searchByName(keyword: string): Promise<RoleRow[]> {
    return this.db
      .select()
      .from(roles)
      .where(and(ilike(roles.name, `${keyword}%`), isNull(roles.deletedAt)));
  }
}
