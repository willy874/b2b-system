import { Injectable } from '@nestjs/common';

import type { PermissionKey } from '@/common/types';
import type { PermissionSet } from '@/core/cache';
import { PermissionCacheService } from '@/core/cache';
import { AppException } from '@/core/errors';
import type { PermissionRow } from '@/db/schema';

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

  /** 指派角色前：該角色帶的權限必須全部是 actor 已持有的。 */
  async assertRolesAssignable(actorId: string, roleIds: readonly string[]): Promise<void> {
    if (roleIds.length === 0) return;
    const { isSuperAdmin } = await this.getPermissionSet(actorId);
    if (isSuperAdmin) return;
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

  /** 角色的權限或成員變更時呼叫。順序很重要：刪除角色前必須先查出使用者。 */
  async invalidateByRole(roleId: string): Promise<void> {
    const userIds = await this.repo.findUserIdsByRole(roleId);
    this.cache.invalidateMany(userIds);
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
