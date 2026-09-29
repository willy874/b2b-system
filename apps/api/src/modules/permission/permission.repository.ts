import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { PermissionKey } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { PermissionRow, PermissionScope } from '@/db/schema';
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  workspaceMemberRoles,
  workspaceMembers,
  workspaces,
} from '@/db/schema';

import { SUPER_ADMIN_SLUG } from './permission.constants';

@Injectable()
export class PermissionRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** 最熱的查詢：使用者透過所有全域角色間接持有的權限鍵（平台範圍）。 */
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

  /** 使用者在這個工作區透過工作區角色持有的權限鍵（工作區範圍）。 */
  async findWorkspacePermissionKeys(userId: string, workspaceId: string): Promise<PermissionKey[]> {
    const rows = await this.db
      .selectDistinct({ key: permissions.key })
      .from(workspaceMemberRoles)
      .innerJoin(roles, and(eq(roles.id, workspaceMemberRoles.roleId), isNull(roles.deletedAt)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, workspaceMemberRoles.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(
        and(
          eq(workspaceMemberRoles.userId, userId),
          eq(workspaceMemberRoles.workspaceId, workspaceId),
        ),
      );
    return rows.map((row) => row.key as PermissionKey);
  }

  /** 工作區存在（未刪除），以及使用者是不是它的成員。 */
  async findMembership(
    userId: string,
    workspaceId: string,
  ): Promise<{ exists: boolean; isMember: boolean }> {
    const [row] = await this.db
      .select({ memberId: workspaceMembers.userId })
      .from(workspaces)
      .leftJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
      )
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .limit(1);
    return { exists: Boolean(row), isMember: Boolean(row?.memberId) };
  }

  /** 使用者所屬的（未刪除的）工作區。 */
  async findMemberWorkspaceIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .innerJoin(
        workspaces,
        and(eq(workspaces.id, workspaceMembers.workspaceId), isNull(workspaces.deletedAt)),
      )
      .where(eq(workspaceMembers.userId, userId));
    return rows.map((row) => row.id);
  }

  /** 權限目錄的鍵；`scope` 不帶是全部。 */
  async findAllPermissionKeys(scope?: PermissionScope): Promise<PermissionKey[]> {
    const rows = await this.db
      .select({ key: permissions.key })
      .from(permissions)
      .where(scope ? eq(permissions.scope, scope) : undefined);
    return rows.map((row) => row.key as PermissionKey);
  }

  /** 角色的範圍（範圍檢查用；已刪除的不列）。 */
  async findRoleScopes(
    roleIds: readonly string[],
  ): Promise<{ id: string; slug: string; scope: PermissionScope }[]> {
    if (roleIds.length === 0) return [];
    return this.db
      .select({ id: roles.id, slug: roles.slug, scope: roles.scope })
      .from(roles)
      .where(and(inArray(roles.id, [...roleIds]), isNull(roles.deletedAt)));
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

  /**
   * 角色的權限變更時，要失效哪些使用者的快取：全域角色看 `user_roles`，
   * 工作區角色看所有工作區的 `workspace_member_roles`（去重）。
   */
  async findUserIdsByRole(roleId: string): Promise<string[]> {
    const [global, scoped] = await Promise.all([
      this.db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.roleId, roleId)),
      this.db
        .selectDistinct({ userId: workspaceMemberRoles.userId })
        .from(workspaceMemberRoles)
        .where(eq(workspaceMemberRoles.roleId, roleId)),
    ]);
    return [...new Set([...global, ...scoped].map((row) => row.userId))];
  }
}
