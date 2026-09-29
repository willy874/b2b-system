import { Injectable } from '@nestjs/common';

import type { PermissionKey } from '@/common/types';
import type { PermissionSet } from '@/core/cache';
import { PermissionCacheService } from '@/core/cache';
import { AppException } from '@/core/errors';
import type { PermissionRow, PermissionScope } from '@/db/schema';
import { PERMISSION_SCOPE_OF } from '@/db/seeds/permissions';

import { SUPER_ADMIN_SLUG } from './permission.constants';
import { PermissionRepository } from './permission.repository';

export interface PermissionCatalog {
  items: PermissionRow[];
  groups: Array<{ resource: string; nameI18nKey: string; keys: string[] }>;
}

@Injectable()
export class PermissionService {
  constructor(
    private readonly repo: PermissionRepository,
    private readonly cache: PermissionCacheService,
  ) {}

  /** 平台範圍：全域角色的權限鍵。 */
  async getPermissionSet(userId: string): Promise<PermissionSet> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const [keys, isSuperAdmin] = await Promise.all([
      this.repo.findPermissionKeysByUser(userId),
      this.repo.isSuperAdmin(userId),
    ]);

    const value: PermissionSet = { permissions: new Set(keys), isSuperAdmin, canEnter: true };
    this.cache.set(userId, value);
    return value;
  }

  /**
   * 工作區範圍：`P(u, W)` = 全域角色的 platform 鍵 ∪ 在 W 的工作區角色的 workspace 鍵
   * （docs/adr/0018-workspace-tenancy.md D4）。不是成員（或工作區不存在）時 `canEnter = false`；
   * super-admin 只要工作區存在就能進入（D5）。
   */
  async getWorkspacePermissionSet(userId: string, workspaceId: string): Promise<PermissionSet> {
    const cached = this.cache.get(userId, workspaceId);
    if (cached) return cached;

    const [platform, membership, scoped] = await Promise.all([
      this.getPermissionSet(userId),
      this.repo.findMembership(userId, workspaceId),
      this.repo.findWorkspacePermissionKeys(userId, workspaceId),
    ]);
    const value: PermissionSet = {
      permissions: new Set(membership.isMember ? [...platform.permissions, ...scoped] : []),
      isSuperAdmin: platform.isSuperAdmin,
      canEnter: membership.exists && (membership.isMember || platform.isSuperAdmin),
    };
    this.cache.set(userId, value, workspaceId);
    return value;
  }

  /** 供 /auth/profile 使用：平台範圍的鍵；super-admin 展開成平台範圍的全集，讓前端沒有特例。 */
  async getEffectivePermissionKeys(userId: string): Promise<PermissionKey[]> {
    const { permissions, isSuperAdmin } = await this.getPermissionSet(userId);
    return isSuperAdmin ? this.repo.findAllPermissionKeys('platform') : [...permissions];
  }

  /** 供 `GET /workspaces/:id/me` 使用：工作區範圍的鍵（前端與平台範圍的取聯集）。 */
  async getEffectiveWorkspacePermissionKeys(
    userId: string,
    workspaceId: string,
  ): Promise<PermissionKey[]> {
    const { permissions, isSuperAdmin } = await this.getWorkspacePermissionSet(userId, workspaceId);
    if (isSuperAdmin) return this.repo.findAllPermissionKeys('workspace');
    return [...permissions].filter((key) => PERMISSION_SCOPE_OF[key] === 'workspace');
  }

  /**
   * 反提權：待授予的權限必須是 actor 已持有的。
   * 帶 `workspaceId`：以 actor 在那個工作區的集合比對（指派工作區角色）。
   * 不帶（編輯角色定義）：只比對平台範圍的鍵——工作區範圍的鍵在角色定義上不構成授予，
   * 真正的授予發生在指派時，那時以指派者在該工作區的集合檢查（docs/adr/0018-workspace-tenancy.md D3）。
   */
  async assertGrantable(
    actorId: string,
    keys: readonly PermissionKey[],
    workspaceId?: string,
  ): Promise<void> {
    const { skipped } = await this.filterGrantable(actorId, keys, workspaceId);
    if (skipped.length) {
      throw new AppException('AUTHZ_ESCALATION', { missing: skipped });
    }
  }

  /**
   * 指派全域角色前：該角色帶的權限必須全部是 actor 已持有的。
   * super-admin 在 role_permissions 沒有列，只看權限鍵會查出空集合而放行，
   * 所以用 slug 特判：只有 super-admin 能指派 super-admin（docs/architecture/backend/05-rbac.md §4.1）。
   */
  async assertRolesAssignable(actorId: string, roleIds: readonly string[]): Promise<void> {
    if (roleIds.length === 0) return;
    const { permissions, isSuperAdmin } = await this.getPermissionSet(actorId);
    if (isSuperAdmin) return;
    if (await this.repo.includesSuperAdminRole(roleIds)) {
      // 即使 actor 已持有目錄中每個權限鍵也要擋：super-admin 還會繞過未來新增的權限與業務保護
      const allKeys = await this.repo.findAllPermissionKeys('platform');
      const missing = allKeys.filter((key) => !permissions.has(key));
      throw new AppException('AUTHZ_ESCALATION', { missing, role: SUPER_ADMIN_SLUG });
    }
    const keys = await this.repo.findPermissionKeysByRoles(roleIds);
    await this.assertGrantable(actorId, keys);
  }

  /** 指派工作區角色前：角色帶的權限必須全部是 actor 在這個工作區已持有的。 */
  async assertWorkspaceRolesAssignable(
    actorId: string,
    workspaceId: string,
    roleIds: readonly string[],
  ): Promise<void> {
    if (roleIds.length === 0) return;
    const keys = await this.repo.findPermissionKeysByRoles(roleIds);
    await this.assertGrantable(actorId, keys, workspaceId);
  }

  /**
   * 角色都存在（未刪除）而且範圍是 `scope`：全域角色只能指派給使用者、工作區角色只能指派在工作區裡。
   * 不存在 → `ROLE_NOT_FOUND`；範圍不符 → `ROLE_SCOPE_MISMATCH`（DB trigger 是第二道防線）。
   */
  async assertRoleScope(roleIds: readonly string[], scope: PermissionScope): Promise<void> {
    if (roleIds.length === 0) return;
    const unique = [...new Set(roleIds)];
    const rows = await this.repo.findRoleScopes(unique);
    if (rows.length !== unique.length) {
      const found = new Set(rows.map((row) => row.id));
      throw new AppException('ROLE_NOT_FOUND', { roleIds: unique.filter((id) => !found.has(id)) });
    }
    const mismatched = rows.filter((row) => row.scope !== scope);
    if (mismatched.length) {
      throw new AppException('ROLE_SCOPE_MISMATCH', {
        expected: scope,
        roles: mismatched.map((row) => row.slug),
      });
    }
  }

  /** 權限鍵的範圍必須是 `scope`（角色的權限只能是同範圍的，D3）。 */
  assertKeyScope(keys: readonly PermissionKey[], scope: PermissionScope): void {
    const mismatched = keys.filter((key) => PERMISSION_SCOPE_OF[key] !== scope);
    if (mismatched.length) {
      throw new AppException('ROLE_SCOPE_MISMATCH', { expected: scope, keys: mismatched });
    }
  }

  /** 反提權的「略過」版本：回傳 actor 可以授予的子集（角色複製用；範圍規則同 `assertGrantable`）。 */
  async filterGrantable(
    actorId: string,
    keys: readonly PermissionKey[],
    workspaceId?: string,
  ): Promise<{ granted: PermissionKey[]; skipped: PermissionKey[] }> {
    if (keys.length === 0) return { granted: [], skipped: [] };
    const { permissions, isSuperAdmin } = workspaceId
      ? await this.getWorkspacePermissionSet(actorId, workspaceId)
      : await this.getPermissionSet(actorId);
    if (isSuperAdmin) return { granted: [...keys], skipped: [] };
    const checked = (key: PermissionKey) =>
      workspaceId !== undefined || PERMISSION_SCOPE_OF[key] === 'platform';
    const granted = keys.filter((key) => !checked(key) || permissions.has(key));
    const skipped = keys.filter((key) => checked(key) && !permissions.has(key));
    return { granted, skipped };
  }

  async assertKeysExist(keys: readonly string[]): Promise<Map<string, string>> {
    const found = await this.repo.findIdsByKeys(keys);
    const unknown = keys.filter((key) => !found.has(key));
    if (unknown.length) {
      throw new AppException('PERMISSION_UNKNOWN', { unknown });
    }
    return found;
  }

  async getCatalog(): Promise<PermissionCatalog> {
    const items = await this.repo.listCatalog();
    const byResource = new Map<string, string[]>();
    for (const item of items) {
      const keys = byResource.get(item.resource) ?? [];
      keys.push(item.key);
      byResource.set(item.resource, keys);
    }
    return {
      items,
      groups: [...byResource].map(([resource, keys]) => ({
        resource,
        nameI18nKey: `permission.resource.${resource}`,
        keys,
      })),
    };
  }

  /** 這個使用者在所有範圍（平台與每個工作區）的快取。 */
  invalidateUser(userId: string): void {
    this.cache.invalidate(userId);
  }

  invalidateUsers(userIds: readonly string[]): void {
    this.cache.invalidateMany(userIds);
  }

  invalidateWorkspace(workspaceId: string): void {
    this.cache.invalidateWorkspace(workspaceId);
  }

  invalidateAll(): void {
    this.cache.invalidateAll();
  }

  /** 使用者所屬的工作區（推播的 room 依它加入）。 */
  findMemberWorkspaceIds(userId: string): Promise<string[]> {
    return this.repo.findMemberWorkspaceIds(userId);
  }

  findUserIdsByRole(roleId: string): Promise<string[]> {
    return this.repo.findUserIdsByRole(roleId);
  }
}
