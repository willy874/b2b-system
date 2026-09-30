import { Injectable } from '@nestjs/common';

import type { PermissionKey } from '@/common/types';
import type { PermissionSet } from '@/core/cache';
import { PermissionCacheService } from '@/core/cache';
import { AppException } from '@/core/errors';
import type { PermissionRow } from '@/db/schema';

import { SUPER_ADMIN_SLUG } from './permission.constants';
import { PermissionRepository } from './permission.repository';

/** 批次解析權限時一條查詢帶多少人（`IN` 清單的長度上限，也限制單次結果的大小）。 */
const PERMISSION_BATCH_SIZE = 500;

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

    // 查詢期間若被失效（撤銷權限的交易剛提交），讀到的可能是舊值：不寫回快取
    const ticket = this.cache.ticket();
    const [keys, isSuperAdmin] = await Promise.all([
      this.repo.findPermissionKeysByUser(userId),
      this.repo.isSuperAdmin(userId),
    ]);

    const value: PermissionSet = { permissions: new Set(keys), isSuperAdmin };
    this.cache.set(userId, value, ticket);
    return value;
  }

  /**
   * `getPermissionSet` 的批次版：快取命中的直接用，其餘每批兩條查詢（不是每人兩條）。
   * 給一次影響很多人的地方用（例：角色權限變更後同步即時連線的 room）。
   * 回傳的 Map 含每個傳入的 id（沒有任何角色的人是空集合）。
   */
  async getPermissionSets(userIds: readonly string[]): Promise<Map<string, PermissionSet>> {
    const result = new Map<string, PermissionSet>();
    const missing: string[] = [];
    for (const id of new Set(userIds)) {
      const cached = this.cache.get(id);
      if (cached) result.set(id, cached);
      else missing.push(id);
    }

    for (let start = 0; start < missing.length; start += PERMISSION_BATCH_SIZE) {
      const batch = missing.slice(start, start + PERMISSION_BATCH_SIZE);
      // oxlint-disable-next-line no-await-in-loop -- 分批依序，避免一次佔用多條連線
      const [rows, superAdmins] = await Promise.all([
        this.repo.findPermissionKeysByUsers(batch),
        this.repo.findSuperAdminUserIds(batch),
      ]);
      const superAdminIds = new Set(superAdmins);
      const keysByUser = new Map<string, Set<PermissionKey>>(batch.map((id) => [id, new Set()]));
      for (const row of rows) keysByUser.get(row.userId)?.add(row.key);
      for (const [id, keys] of keysByUser) {
        const value: PermissionSet = { permissions: keys, isSuperAdmin: superAdminIds.has(id) };
        this.cache.set(id, value);
        result.set(id, value);
      }
    }
    return result;
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

  /**
   * 自我鎖定保護：actor 持有 `roleId`，而這個角色的權限變成 `nextRoleKeys`（刪除角色時是空陣列）之後，
   * actor 會失去目前持有的 `guarded` 權限 → `ROLE_SELF_LOCKOUT`。super-admin 豁免（權限是隱含全集）。
   * 沒有持有該角色、或本來就沒有那些權限時不擋（docs/architecture/backend/05-rbac.md §8.4）。
   */
  async assertNoSelfLockout(
    actorId: string,
    roleId: string,
    nextRoleKeys: readonly string[],
    guarded: readonly PermissionKey[],
  ): Promise<void> {
    const { permissions, isSuperAdmin } = await this.getPermissionSet(actorId);
    if (isSuperAdmin) return;
    const held = guarded.filter((key) => permissions.has(key));
    if (held.length === 0) return;
    if (!(await this.repo.userHasRole(actorId, roleId))) return;

    const remaining = new Set<string>([
      ...(await this.repo.findPermissionKeysByUserExcludingRole(actorId, roleId)),
      ...nextRoleKeys,
    ]);
    const lost = held.filter((key) => !remaining.has(key));
    if (lost.length) throw new AppException('ROLE_SELF_LOCKOUT', { lost });
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
