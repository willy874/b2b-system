import { Injectable } from '@nestjs/common';

import type { PermissionKey } from '@/common/types';
import {
  AuthzRevision,
  AuthzService,
  ROLE_HOLDER_RELATION,
  SUPER_ADMIN_RELATION,
  TENANT_OBJECT,
} from '@/core/authz';
import type { RelationRef } from '@/core/authz';
import type { PermissionSet } from '@/core/cache';
import { PermissionCacheService } from '@/core/cache';
import type { DbOrTx } from '@/core/database';
import { AppException } from '@/core/errors';
import { getRequestContext } from '@/core/http';
import type { PermissionRow } from '@/db/schema';
import {
  ALL_PERMISSION_KEYS,
  implyingPermissions,
  PERMISSION_DEPENDENCIES,
  permissionClosure,
} from '@/db/seeds/permissions';
import type { PermissionDependency } from '@/db/seeds/permissions';

import { SUPER_ADMIN_SLUG } from './permission.constants';
import { PermissionRepository } from './permission.repository';

/** 批次解析權限時一條查詢帶多少人（`IN` 清單的長度上限，也限制單次結果的大小）。 */
const PERMISSION_BATCH_SIZE = 500;

/**
 * 對外 API 的 token 限縮了權限（docs/adr/0027-api-tokens-external-api.md D3）：這個請求以 token 認證、問的又是
 * token 的擁有者時，權限與 scopes（已含依賴樹的閉包）取交集；super-admin 也只剩 scopes。快取存的是帳號本身的權限，
 * 交集在讀出時算，所以同一個人在內部 api 的請求不受影響。資料夾等資源上的能力跟著帳號（`subjects` 不變）。
 */
function withTokenScopes(userId: string, value: PermissionSet): PermissionSet {
  const token = getRequestContext()?.apiToken;
  if (!token?.scopes || token.userId !== userId) return value;
  const permissions = new Set<PermissionKey>();
  for (const key of token.scopes as ReadonlySet<PermissionKey>) {
    if (value.isSuperAdmin || value.permissions.has(key)) permissions.add(key);
  }
  return { permissions, isSuperAdmin: false, subjects: value.subjects, tokenScoped: true };
}

export interface PermissionCatalogItem extends PermissionRow {
  includes: PermissionKey[];
  requires: PermissionKey[];
}

export interface PermissionCatalog {
  items: PermissionCatalogItem[];
  groups: Array<{ resource: string; nameI18nKey: string; keys: string[] }>;
}

/** 角色實際持有的一個鍵（docs/rbac/02-permission-catalog.md §9）。 */
export interface EffectivePermission {
  key: PermissionKey;
  source: 'explicit' | 'implied';
  impliedBy: PermissionKey[];
}

@Injectable()
export class PermissionService {
  constructor(
    private readonly repo: PermissionRepository,
    private readonly cache: PermissionCacheService,
    private readonly authz: AuthzService,
    private readonly revision: AuthzRevision,
  ) {}

  async getPermissionSet(userId: string): Promise<PermissionSet> {
    const cached = this.cache.get(userId);
    if (cached) return withTokenScopes(userId, cached);

    // 查詢期間若被失效（撤銷權限的交易剛提交），讀到的可能是舊值：不寫回快取
    const ticket = this.cache.ticket();
    const loaded = await this.loadBatch([userId]);
    const value = loaded.get(userId) as PermissionSet;
    this.cache.set(userId, value, ticket);
    return withTokenScopes(userId, value);
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
      if (cached) result.set(id, withTokenScopes(id, cached));
      else missing.push(id);
    }

    for (let start = 0; start < missing.length; start += PERMISSION_BATCH_SIZE) {
      const batch = missing.slice(start, start + PERMISSION_BATCH_SIZE);
      // 與 getPermissionSet 相同：載入期間被失效過的人不寫回快取
      const ticket = this.cache.ticket();
      // oxlint-disable-next-line no-await-in-loop -- 分批依序，避免一次佔用多條連線
      const loaded = await this.loadBatch(batch);
      for (const [id, value] of loaded) {
        this.cache.set(id, value, ticket);
        result.set(id, withTokenScopes(id, value));
      }
    }
    return result;
  }

  /** 一批人的權限：由關係圖解析，含權限依賴樹的閉包（docs/adr/0024-relationship-based-access-control.md）。 */
  private async loadBatch(batch: readonly string[]): Promise<Map<string, PermissionSet>> {
    const resolved = await this.authz.tenantPermissionsOf(batch, { withDependencies: true });
    return new Map(
      [...resolved].map(([id, { effective, isSuperAdmin, subjects }]) => [
        id,
        { permissions: effective, isSuperAdmin, subjects },
      ]),
    );
  }

  /** 供 /auth/profile 使用：super-admin 展開成全集，讓前端沒有特例。 */
  async getEffectivePermissionKeys(userId: string): Promise<PermissionKey[]> {
    const { permissions, isSuperAdmin } = await this.getPermissionSet(userId);
    return isSuperAdmin ? this.repo.findAllPermissionKeys() : [...permissions];
  }

  /**
   * 反提權的通用入口（docs/adr/0024-relationship-based-access-control.md G4）：把某個主體放進 `targets` 的每一個
   * `物件#關係`，主體取得的租戶能力（`AuthzService.grantedCapabilities`）都要是 actor 持有的。
   * 權限鍵、角色、群組（含上層群組持有的角色）都走這裡；資料夾等級在檔案管理器內以同一份模型比對。
   *
   * 缺少 `superAdmin`（目標帶有 super-admin 角色）時，錯誤的 `details` 是 `{ missing: 目錄中 actor 沒有的鍵, role: 'super-admin' }`：
   * 即使 actor 已持有目錄中每個權限鍵也要擋——super-admin 還會繞過未來新增的權限與業務保護（05-rbac.md §4.1）。
   */
  async assertCanGrant(
    actorId: string,
    targets: readonly RelationRef[],
    tx?: DbOrTx,
  ): Promise<void> {
    if (targets.length === 0) return;
    const { permissions, isSuperAdmin } = await this.getPermissionSet(actorId);
    if (isSuperAdmin) return;
    const capabilities = await this.authz.grantedCapabilities(targets, { tx });
    const missing = new Set<string>();
    for (const capability of capabilities) {
      // 租戶以外的能力（資料夾的 can_*）要用資源的判斷器比對，不是權限集合
      if (capability.object.type !== TENANT_OBJECT.type) {
        throw new Error(
          `assertCanGrant 只比對租戶上的能力：${capability.object.type}#${capability.relation}`,
        );
      }
      if (!permissions.has(capability.relation as PermissionKey)) missing.add(capability.relation);
    }
    if (missing.has(SUPER_ADMIN_RELATION)) {
      const allKeys = await this.repo.findAllPermissionKeys();
      throw new AppException('AUTHZ_ESCALATION', {
        missing: allKeys.filter((key) => !permissions.has(key)),
        role: SUPER_ADMIN_SLUG,
      });
    }
    if (missing.size) {
      throw new AppException('AUTHZ_ESCALATION', {
        missing: ALL_PERMISSION_KEYS.filter((key) => missing.has(key)),
      });
    }
  }

  /** 反提權：待授予的權限必須是 actor 已持有的。 */
  async assertGrantable(actorId: string, keys: readonly PermissionKey[]): Promise<void> {
    await this.assertCanGrant(
      actorId,
      keys.map((key) => ({ object: TENANT_OBJECT, relation: key })),
    );
  }

  /**
   * 指派角色前：該角色帶的權限必須全部是 actor 已持有的。super-admin 角色帶的是 `superAdmin` 這個能力，
   * 只有 super-admin 自己有，所以只有 super-admin 能指派 super-admin（docs/architecture/backend/05-rbac.md §4.1）。
   */
  async assertRolesAssignable(
    actorId: string,
    roleIds: readonly string[],
    tx?: DbOrTx,
  ): Promise<void> {
    await this.assertCanGrant(
      actorId,
      roleIds.map((id) => ({ object: { type: 'role', id }, relation: ROLE_HOLDER_RELATION })),
      tx,
    );
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

    // 剩下的鍵也要套上依賴樹的閉包：拿掉 file:update 時，file:delete 仍會帶回它
    const remaining = permissionClosure([
      ...(await this.repo.findPermissionKeysByUserExcludingRole(actorId, roleId)),
      ...(nextRoleKeys as PermissionKey[]),
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

  /**
   * 角色實際持有的鍵：明確授予的 ＋ 依賴樹帶出的，依目錄順序。super-admin 是全集（都算隱含、`impliedBy` 為空）。
   * 角色權限編輯器（技能樹）以此顯示「已包含（由 …）」。
   */
  describeRolePermissions(
    explicitKeys: readonly PermissionKey[],
    isSuperAdmin: boolean,
  ): EffectivePermission[] {
    if (isSuperAdmin) {
      return ALL_PERMISSION_KEYS.map((key) => ({ key, source: 'implied', impliedBy: [] }));
    }
    const explicit = new Set(explicitKeys);
    const closure = permissionClosure(explicitKeys);
    return ALL_PERMISSION_KEYS.filter((key) => closure.has(key)).map((key) => ({
      key,
      source: explicit.has(key) ? 'explicit' : 'implied',
      impliedBy: implyingPermissions(key, explicitKeys),
    }));
  }

  /** 目錄的列加上依賴樹的子能力與依賴（從程式碼供應，不存 DB）。 */
  withDependencies(rows: readonly PermissionRow[]): PermissionCatalogItem[] {
    return rows.map((row) => {
      const entry: PermissionDependency | undefined =
        PERMISSION_DEPENDENCIES[row.key as keyof typeof PERMISSION_DEPENDENCIES];
      return {
        ...row,
        includes: [...(entry?.includes ?? [])],
        requires: [...(entry?.requires ?? [])],
      };
    });
  }

  async getCatalog(): Promise<PermissionCatalog> {
    const items = this.withDependencies(await this.repo.listCatalog());
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

  /**
   * 角色的持有者或角色的權限變了：在寫入的交易 **提交之後** 呼叫。整個租戶的權限快取失效、
   * 推播重算 room，並廣播給其他程序（docs/adr/0024-relationship-based-access-control.md D7、D8）——
   * 不必事先查出受影響的人。`userIds` 見 `AuthzRevision.changed`。
   */
  permissionsChanged(userIds?: readonly string[]): Promise<void> {
    return this.revision.changed(userIds);
  }

  findUserIdsByRole(roleId: string): Promise<string[]> {
    return this.repo.findUserIdsByRole(roleId);
  }

  /**
   * 目前持有 `key` 的 **可登入** 使用者（未刪除、`active`；登入失敗鎖定中的仍算，鎖定會自己到期），含 super-admin
   * 與經由權限依賴樹帶來它的鍵（持有 `user:update` 的人也持有 `user:read`）。給「要通知有某個權限的人」用
   * （例：審批送出時的審核者，docs/adr/0026-notification-center.md D5）；結果是當下的快照。
   *
   * 兩段：關係圖的反向查詢找出候選（持有 `key`、帶來它的鍵或 superAdmin 的角色的持有者，一條 SQL），
   * 過濾掉停用與刪除的人之後，再以與授權相同的正向解析（`getPermissionSets`，批次）確認——
   * 反向查詢只負責縮小範圍，是否持有由同一個判斷器決定，模型之後改變也不會算錯。
   */
  async findActiveUserIdsWithPermission(key: PermissionKey): Promise<string[]> {
    const relations = [key, ...implyingPermissions(key, ALL_PERMISSION_KEYS), SUPER_ADMIN_RELATION];
    const candidates = await this.authz.usersWithTenantRelations(relations);
    const active = await this.repo.filterActiveUserIds(candidates);
    const sets = await this.getPermissionSets(active);
    return active.filter((id) => {
      const set = sets.get(id);
      return Boolean(set && (set.isSuperAdmin || set.permissions.has(key)));
    });
  }
}
