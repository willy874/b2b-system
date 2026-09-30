import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import type { PermissionKey } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import type { PermissionRow } from '@/db/schema';
import { permissions, rolePermissions, roles, userRoles } from '@/db/schema';

import { SUPER_ADMIN_SLUG } from './permission.constants';

@Injectable()
export class PermissionRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 最熱的查詢：使用者透過所有角色間接持有的權限鍵。 */
  async findPermissionKeysByUser(userId: string, db: DbOrTx = this.db): Promise<PermissionKey[]> {
    const rows = await db
      .selectDistinct({ key: permissions.key })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId));
    return rows.map((row) => row.key as PermissionKey);
  }

  /** 使用者透過「這個角色以外」的角色持有的權限鍵（評估改動一個角色對持有者的影響）。 */
  async findPermissionKeysByUserExcludingRole(
    userId: string,
    roleId: string,
  ): Promise<PermissionKey[]> {
    const rows = await this.db
      .selectDistinct({ key: permissions.key })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(userRoles.userId, userId), ne(userRoles.roleId, roleId)));
    return rows.map((row) => row.key as PermissionKey);
  }

  /** 使用者是否持有這個角色。 */
  async userHasRole(userId: string, roleId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .limit(1);
    return Boolean(row);
  }

  /** `findPermissionKeysByUser` 的批次版：一條查詢取得多人的權限鍵（沒有任何權限的人不會出現）。 */
  async findPermissionKeysByUsers(
    userIds: readonly string[],
    db: DbOrTx = this.db,
  ): Promise<Array<{ userId: string; key: PermissionKey }>> {
    if (userIds.length === 0) return [];
    const rows = await db
      .selectDistinct({ userId: userRoles.userId, key: permissions.key })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(inArray(userRoles.userId, [...userIds]));
    return rows.map((row) => ({ userId: row.userId, key: row.key as PermissionKey }));
  }

  /** `isSuperAdmin` 的批次版：這些人之中持有 super-admin 的。 */
  async findSuperAdminUserIds(userIds: readonly string[], db: DbOrTx = this.db): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await db
      .selectDistinct({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          inArray(userRoles.userId, [...userIds]),
          eq(roles.slug, SUPER_ADMIN_SLUG),
          isNull(roles.deletedAt),
        ),
      );
    return rows.map((row) => row.userId);
  }

  async isSuperAdmin(userId: string, db: DbOrTx = this.db): Promise<boolean> {
    const [row] = await db
      .select({ one: sql<number>`1` })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(userRoles.userId, userId),
          eq(roles.slug, SUPER_ADMIN_SLUG),
          isNull(roles.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async findAllPermissionKeys(): Promise<PermissionKey[]> {
    const rows = await this.db.select({ key: permissions.key }).from(permissions);
    return rows.map((row) => row.key as PermissionKey);
  }

  async findPermissionKeysByRoles(roleIds: readonly string[]): Promise<PermissionKey[]> {
    if (roleIds.length === 0) return [];
    const rows = await this.db
      .selectDistinct({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(inArray(rolePermissions.roleId, [...roleIds]));
    return rows.map((row) => row.key as PermissionKey);
  }

  /** super-admin 是隱含全集、在 role_permissions 沒有列，指派前要另外用 slug 判斷。 */
  async includesSuperAdminRole(roleIds: readonly string[]): Promise<boolean> {
    if (roleIds.length === 0) return false;
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(roles)
      .where(and(inArray(roles.id, [...roleIds]), eq(roles.slug, SUPER_ADMIN_SLUG)))
      .limit(1);
    return Boolean(row);
  }

  async listCatalog(): Promise<PermissionRow[]> {
    return this.db.select().from(permissions).orderBy(asc(permissions.sortOrder));
  }

  async findIdsByKeys(keys: readonly string[], db: DbOrTx = this.db): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();
    const rows = await db
      .select({ id: permissions.id, key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, [...keys]));
    return new Map(rows.map((row) => [row.key, row.id]));
  }

  /** 角色的權限變更時，要失效哪些使用者的快取。 */
  async findUserIdsByRole(roleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId));
    return rows.map((row) => row.userId);
  }
}
