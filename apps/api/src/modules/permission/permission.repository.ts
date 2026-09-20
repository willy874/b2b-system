import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { PermissionKey } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { PermissionRow } from '@/db/schema';
import { permissions, rolePermissions, roles, userRoles } from '@/db/schema';

import { SUPER_ADMIN_SLUG } from './permission.constants';

@Injectable()
export class PermissionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** 最熱的查詢：使用者透過所有角色間接持有的權限鍵。 */
  async findPermissionKeysByUser(userId: string): Promise<PermissionKey[]> {
    const rows = await this.db
      .selectDistinct({ key: permissions.key })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId));
    return rows.map((row) => row.key as PermissionKey);
  }

  async isSuperAdmin(userId: string): Promise<boolean> {
    const [row] = await this.db
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
