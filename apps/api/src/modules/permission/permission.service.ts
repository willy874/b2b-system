import { Injectable } from '@nestjs/common';

import type { PermissionKey } from '@/common/types';
import type { PermissionSet } from '@/core/cache';
import { PermissionCacheService } from '@/core/cache';
import { AppException } from '@/core/errors';
import type { PermissionRow } from '@/db/schema';

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

  async getPermissionSet(userId: string): Promise<PermissionSet> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const [keys, isSuperAdmin] = await Promise.all([
      this.repo.findPermissionKeysByUser(userId),
      this.repo.isSuperAdmin(userId),
    ]);

    const value: PermissionSet = { permissions: new Set(keys), isSuperAdmin };
    this.cache.set(userId, value);
    return value;
  }

  /** 供 /auth/profile 使用：super-admin 展開成全集，讓前端沒有特例。 */
  async getEffectivePermissionKeys(userId: string): Promise<PermissionKey[]> {
    const { permissions, isSuperAdmin } = await this.getPermissionSet(userId);
    return isSuperAdmin ? this.repo.findAllPermissionKeys() : [...permissions];
  }

  /** 反提權：待授予的權限必須是 actor 已持有的。 */
  async assertGrantable(actorId: string, keys: readonly PermissionKey[]): Promise<void> {
    if (keys.length === 0) return;
    const { permissions, isSuperAdmin } = await this.getPermissionSet(actorId);
    if (isSuperAdmin) return;
    const missing = keys.filter((key) => !permissions.has(key));
    if (missing.length) {
      throw new AppException('AUTHZ_ESCALATION', { missing });
    }
  }

  /**
   * 指派角色前：該角色帶的權限必須全部是 actor 已持有的。
   * super-admin 在 role_permissions 沒有列，只看權限鍵會查出空集合而放行，
   * 所以用 slug 特判：只有 super-admin 能指派 super-admin（docs/architecture/backend/05-rbac.md §4.1）。
   */
  async assertRolesAssignable(actorId: string, roleIds: readonly string[]): Promise<void> {
    if (roleIds.length === 0) return;
    const { permissions, isSuperAdmin } = await this.getPermissionSet(actorId);
    if (isSuperAdmin) return;
    if (await this.repo.includesSuperAdminRole(roleIds)) {
      // 即使 actor 已持有目錄中每個權限鍵也要擋：super-admin 還會繞過未來新增的權限與業務保護
      const allKeys = await this.repo.findAllPermissionKeys();
      const missing = allKeys.filter((key) => !permissions.has(key));
      throw new AppException('AUTHZ_ESCALATION', { missing, role: SUPER_ADMIN_SLUG });
    }
    const keys = await this.repo.findPermissionKeysByRoles(roleIds);
    await this.assertGrantable(actorId, keys);
  }

  /** 反提權的「略過」版本：回傳 actor 可以授予的子集（角色複製用）。 */
  async filterGrantable(
    actorId: string,
    keys: readonly PermissionKey[],
  ): Promise<{ granted: PermissionKey[]; skipped: PermissionKey[] }> {
    const { permissions, isSuperAdmin } = await this.getPermissionSet(actorId);
    if (isSuperAdmin) return { granted: [...keys], skipped: [] };
    const granted = keys.filter((key) => permissions.has(key));
    const skipped = keys.filter((key) => !permissions.has(key));
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

  invalidateUser(userId: string): void {
    this.cache.invalidate(userId);
  }

  invalidateUsers(userIds: readonly string[]): void {
    this.cache.invalidateMany(userIds);
  }

  invalidateAll(): void {
    this.cache.invalidateAll();
  }

  findUserIdsByRole(roleId: string): Promise<string[]> {
    return this.repo.findUserIdsByRole(roleId);
  }
}
