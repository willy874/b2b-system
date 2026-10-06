import { Injectable } from '@nestjs/common';

import type { AuthUser, PermissionKey } from '@/common/types';
import {
  AuthzRevision,
  AuthzService,
  parseSubjectKey,
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
import { ROLE_OBJECT_TYPE } from '@/db/schema';
import {
  ALL_PERMISSION_KEYS,
  implyingPermissions,
  PERMISSION_DEPENDENCIES,
  permissionClosure,
} from '@/db/seeds/permissions';
import type { PermissionDependency } from '@/db/seeds/permissions';
import { AuditService } from '@/modules/audit-log/audit.service';

import { SUPER_ADMIN_SLUG } from './permission.constants';
import { PermissionRepository } from './permission.repository';

/** 批次解析權限時一條查詢帶多少人（`IN` 清單的長度上限，也限制單次結果的大小）。 */
const PERMISSION_BATCH_SIZE = 500;

/**
 * 對外 API 的 token 限縮了權限（docs/architecture/06-external-api.md §9.2 D3）：這個請求以 token 認證、問的又是
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

/** 主體閉包裡的角色（`role:<id>#holder`）。 */
function roleIdsIn(subjects: readonly string[]): string[] {
  return subjects.flatMap((key) => {
    const { object, relation } = parseSubjectKey(key);
    return object.type === ROLE_OBJECT_TYPE && relation === ROLE_HOLDER_RELATION ? [object.id] : [];
  });
}

export interface PermissionCatalogItem extends PermissionRow {
  includes: PermissionKey[];
  requires: PermissionKey[];
}

export interface PermissionCatalog {
  items: PermissionCatalogItem[];
  groups: Array<{ resource: string; nameI18nKey: string; keys: string[] }>;
}

/**
 * Service 層自己做的權限判斷（`assertHasAll`／`assertHasAny`）被拒絕時，`authz.denied` 稽核要記的情境。
 * 欄位與 `PermissionsGuard` 的稽核相同（`metadata.route`），稽核頁不必分兩種讀法。
 */
export interface PermissionCheckContext {
  /** 被拒絕的端點，格式同 guard：`<METHOD> <路由樣板>`（例：`POST /approvals/:id/approve`）。 */
  route: string;
  /** 另外記進稽核 `metadata` 的資訊（例：`{ roleId }`）；`route`、`required`、`missing` 由這裡填。 */
  metadata?: Record<string, unknown>;
  /** 在呼叫端的交易內判斷時傳入：權限集合沒有快取時以同一個交易查（`getPermissionSet`）。拒絕的稽核仍不跟著交易。 */
  tx?: DbOrTx;
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
    private readonly audit: AuditService,
  ) {}

  /**
   * 一位使用者的權限集合（快取，載入期間被失效過就不寫回）。
   *
   * 在呼叫端的交易內（持有鎖）判斷時傳 `tx`：快取沒命中就以同一個交易查，不從連線池另取一條連線
   * （池子滿時會與等鎖的交易互相等待，docs/architecture/backend/02-database.md §6.2）。交易內讀到的可能含這個交易自己的寫入，
   * 所以 **不寫回快取**。能在交易之前取好的就先取好（例：資料夾結構的寫入，`FileAccessService.permissionsOf`）。
   */
  async getPermissionSet(userId: string, tx?: DbOrTx): Promise<PermissionSet> {
    const cached = this.cache.get(userId);
    if (cached) return withTokenScopes(userId, cached);
    if (tx) {
      const loaded = await this.loadBatch([userId], tx);
      return withTokenScopes(userId, loaded.get(userId) as PermissionSet);
    }

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

  /** 一批人的權限：由關係圖解析，含權限依賴樹的閉包（docs/rbac/01-domain-model.md §9）。 */
  private async loadBatch(
    batch: readonly string[],
    tx?: DbOrTx,
  ): Promise<Map<string, PermissionSet>> {
    const resolved = await this.authz.tenantPermissionsOf(batch, { withDependencies: true, tx });
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
   * Service 層的權限判斷：`keys` 全部都要有。路由的宣告表達不了的情況用它（依資源類型、依審批類型而定的權限，
   * 「自己或有權限」，只在某些狀態才需要的權限）。與 `PermissionsGuard` 同一個形狀（docs/architecture/backend/05-rbac.md §3.1）：
   * super-admin 放行；缺少時以 `recordSafely` 寫 `authz.denied`（`metadata: { route, required, missing, ... }`），
   * 再拋 `403 AUTHZ_FORBIDDEN`（`details: { required, missing }`）。稽核不跟著呼叫端的交易：rollback 時拒絕紀錄仍要留下。
   */
  assertHasAll(
    actor: Pick<AuthUser, 'id' | 'email'>,
    keys: readonly PermissionKey[],
    context: PermissionCheckContext,
  ): Promise<void> {
    return this.assertPermissions(actor, keys, 'every', context);
  }

  /** 同 `assertHasAll`，但 `keys` 有任一個就放行（例：進檔案管理器要 `file:access` 或 `file:read`）。 */
  assertHasAny(
    actor: Pick<AuthUser, 'id' | 'email'>,
    keys: readonly PermissionKey[],
    context: PermissionCheckContext,
  ): Promise<void> {
    return this.assertPermissions(actor, keys, 'some', context);
  }

  private async assertPermissions(
    actor: Pick<AuthUser, 'id' | 'email'>,
    keys: readonly PermissionKey[],
    match: 'every' | 'some',
    context: PermissionCheckContext,
  ): Promise<void> {
    if (keys.length === 0) return;
    const { permissions, isSuperAdmin } = await this.getPermissionSet(actor.id, context.tx);
    if (isSuperAdmin) return;
    const granted =
      match === 'every'
        ? keys.every((key) => permissions.has(key))
        : keys.some((key) => permissions.has(key));
    if (granted) return;
    const required = [...keys];
    const missing = keys.filter((key) => !permissions.has(key));
    await this.audit.recordSafely({
      action: 'authz.denied',
      result: 'failure',
      actorId: actor.id,
      actorEmail: actor.email,
      resourceType: 'authz',
      errorCode: 'AUTHZ_FORBIDDEN',
      metadata: { ...context.metadata, route: context.route, required, missing },
    });
    throw new AppException('AUTHZ_FORBIDDEN', { required, missing });
  }

  /**
   * 反提權的通用入口（docs/rbac/01-domain-model.md §9 G4）：把某個主體放進 `targets` 的每一個
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
    const { permissions, isSuperAdmin } = await this.getPermissionSet(actorId, tx);
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

  /** 反提權：待授予的權限必須是 actor 已持有的。在交易內呼叫時傳 `tx`（見 `getPermissionSet`）。 */
  async assertGrantable(
    actorId: string,
    keys: readonly PermissionKey[],
    tx?: DbOrTx,
  ): Promise<void> {
    await this.assertCanGrant(
      actorId,
      keys.map((key) => ({ object: TENANT_OBJECT, relation: key })),
      tx,
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
   *
   * 「持有」與「剩下的權限」都以 actor 的主體閉包判斷（`PermissionSet.subjects` 裡的 `role:<id>#holder`），
   * 經由群組（含巢狀）持有的角色與直接持有的一樣算（docs/rbac/08-groups.md §1）：只經由群組持有 R 的人改 R 也會被擋，
   * 另外經由群組持有同樣權限的人不會被誤擋。在交易內（鎖住角色列之後）呼叫時傳 `tx`：讀取都走同一個交易。
   */
  async assertNoSelfLockout(
    actorId: string,
    roleId: string,
    nextRoleKeys: readonly string[],
    guarded: readonly PermissionKey[],
    tx?: DbOrTx,
  ): Promise<void> {
    const { permissions, isSuperAdmin, subjects = [] } = await this.getPermissionSet(actorId, tx);
    if (isSuperAdmin) return;
    const held = guarded.filter((key) => permissions.has(key));
    if (held.length === 0) return;
    const heldRoleIds = roleIdsIn(subjects);
    if (!heldRoleIds.includes(roleId)) return;

    // 剩下的鍵也要套上依賴樹的閉包：拿掉 file:update 時，file:delete 仍會帶回它
    const others = heldRoleIds.filter((id) => id !== roleId);
    const remaining = permissionClosure([
      ...(await this.repo.findPermissionKeysOfRoles(others, tx)),
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
   * 推播重算 room，並廣播給其他程序（docs/rbac/01-domain-model.md §9.2 D7、D8）——
   * 不必事先查出受影響的人。`userIds` 見 `AuthzRevision.changed`。
   */
  permissionsChanged(userIds?: readonly string[]): Promise<void> {
    return this.revision.changed(userIds);
  }

  /**
   * 持有這個角色的使用者：直接持有的，加上持有它的群組（含巢狀）的成員——群組 g 持有 r 時，g 的成員都持有 r
   * （docs/rbac/08-groups.md §1）。與權限解析走同一張圖（`AuthzService.usersInSubjectSets`）：過期的邊、已刪除的群組不算；
   * **角色本身已刪除時是空的**，刪除角色要在軟刪除之前（交易內、鎖住角色列之後）查。含已刪除、停用的使用者，
   * 給推播（「持有該角色的所有人」，docs/architecture/backend/08-realtime.md §6.1）與「誰會失去權限」的計數用。
   */
  findUserIdsHoldingRole(roleId: string, tx?: DbOrTx): Promise<string[]> {
    return this.authz.usersInSubjectSets(
      [{ type: ROLE_OBJECT_TYPE, id: roleId, relation: ROLE_HOLDER_RELATION }],
      { tx },
    );
  }

  /**
   * 目前持有 `key` 的 **可登入** 使用者（未刪除、`active`；登入失敗鎖定中的仍算，鎖定會自己到期），含 super-admin
   * 與經由權限依賴樹帶來它的鍵（持有 `user:update` 的人也持有 `user:read`）。給「要通知有某個權限的人」用
   * （例：審批送出時的審核者，docs/architecture/backend/15-notification.md §12.2 D5）；結果是當下的快照。
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
