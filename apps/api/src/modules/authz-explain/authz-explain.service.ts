import { Injectable } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { AuthUser, PermissionKey } from '@/common/types';
import {
  AuthzService,
  isPermissionAvailable,
  parseSubjectKey,
  SUPER_ADMIN_RELATION,
} from '@/core/authz';
import type { SubjectKey } from '@/core/authz';
import { AppException } from '@/core/errors';
import { requireTenant } from '@/core/tenant';
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_DEPENDENCIES,
  PERMISSION_SEED,
  permissionClosure,
} from '@/db/seeds/permissions';
import type { PermissionDependencyMap } from '@/db/seeds/permissions';
import { PermissionService } from '@/modules/permission/permission.service';

import { AuthzExplainRepository } from './authz-explain.repository';
import type { ExplainNodeDto, PermissionSourcesDto } from './dto/authz-explain.dto';

/**
 * 呼叫端（擁有資源的模組）補上 user／group／role 以外的節點：名稱與操作者讀不讀得到。
 * 例：檔案模組補資料夾（名稱來自 `file_folders`，讀不讀得到看操作者在那個資料夾的 `can_read`）。
 */
export type ExplainNodeResolver = (
  keys: readonly SubjectKey[],
) => Promise<Map<SubjectKey, { name: string | null; visible: boolean }>>;

/** 只有型別、沒有名稱可查、對誰都看得到的節點（租戶、根目錄、所有人）。 */
const ALWAYS_VISIBLE_TYPES = new Set(['tenant', 'fileRoot']);

/** 權限鍵 → 目錄上的名稱與資源（`PERMISSION_SEED`，與 `GET /permissions` 同一份）。 */
const CATALOG_NAMES = new Map(
  PERMISSION_SEED.map(([resource, action, nameI18nKey]) => [
    `${resource}:${action}`,
    { resource, nameI18nKey, resourceNameI18nKey: `permission.resource.${resource}` },
  ]),
);

/**
 * 「為什麼能做 X」的說明（docs/architecture/iam/01-model.md §9.3 D14、G4b）。
 *
 * - 查自己不需要權限；查別人要 `authz:explain`（`assertCanExplain`）。
 * - 路徑上的節點依 **操作者** 遮蔽：讀不到的群組、角色、使用者、資源只回型別。操作者直接所屬的群組、直接持有的角色一律顯示。
 */
@Injectable()
export class AuthzExplainService {
  constructor(
    private readonly repo: AuthzExplainRepository,
    private readonly authz: AuthzService,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * 查自己一律可以；查別人要 `authz:explain`。拒絕照 `PermissionsGuard` 的形狀：`403 AUTHZ_FORBIDDEN` ＋ `authz.denied` 稽核
   * （路由宣告是 `@Authenticated()`：「自己或有權限」無法以宣告表達）。
   */
  async assertCanExplain(actor: AuthUser, targetUserId: string, route: string): Promise<void> {
    if (actor.id === targetUserId) return;
    await this.permissions.assertHasAll(actor, [PERMISSION.AUTHZ_EXPLAIN], {
      route,
      metadata: { targetUserId },
    });
  }

  /** 說明的對象必須是存在（未刪除）的使用者。 */
  async assertUserExists(userId: string): Promise<void> {
    if (!(await this.repo.userNames([userId])).size) throw new AppException('USER_NOT_FOUND');
  }

  /** 使用者的有效權限，每個鍵附上所有來源（哪個角色、經由哪些群組、明確或由依賴樹帶出）。 */
  async permissionSources(targetUserId: string, actor: AuthUser): Promise<PermissionSourcesDto> {
    await this.assertCanExplain(actor, targetUserId, 'GET /users/:id/permission-sources');
    await this.assertUserExists(targetUserId);

    const sources = await this.authz.tenantSourcesOf(targetUserId);
    const nodes = await this.describePaths(
      actor,
      sources.map((source) => source.path),
    );
    const via = (index: number) => nodes[index] ?? [];

    const superAdmin = sources.findIndex((source) => source.relation === SUPER_ADMIN_RELATION);
    // 角色上的權限鍵（不在目錄裡的關係不是權限：super-admin 等）
    const granted = sources.flatMap((source, index) => {
      const names = CATALOG_NAMES.get(source.relation);
      return names ? [{ ...source, index, grantedNameI18nKey: names.nameI18nKey }] : [];
    });
    const held = permissionClosure(granted.map((source) => source.relation as PermissionKey));
    const dependencies: PermissionDependencyMap = PERMISSION_DEPENDENCIES;
    // 平台未開放的 feature 的鍵不列（docs/architecture/05-tenancy.md §15.2 D1）
    const { features } = requireTenant();
    const visible = (key: PermissionKey) => isPermissionAvailable(key, features);
    const heldOnly = (keys: readonly PermissionKey[] | undefined) =>
      (keys ?? []).filter((key) => held.has(key) && visible(key));
    const items = ALL_PERMISSION_KEYS.filter(visible).flatMap((key) => {
      const from = granted.filter((source) =>
        permissionClosure([source.relation as PermissionKey]).has(key),
      );
      const names = CATALOG_NAMES.get(key);
      return from.length && names
        ? [
            {
              key,
              ...names,
              includes: heldOnly(dependencies[key]?.includes),
              requires: heldOnly(dependencies[key]?.requires),
              sources: from.map((source) => ({
                grantedKey: source.relation,
                grantedNameI18nKey: source.grantedNameI18nKey,
                via: via(source.index),
              })),
            },
          ]
        : [];
    });
    return {
      isSuperAdmin: superAdmin >= 0,
      superAdminVia: superAdmin >= 0 ? via(superAdmin) : null,
      items,
    };
  }

  /**
   * 把路徑（`SubjectKey` 的陣列）描述成節點，依操作者遮蔽（D14）。多條路徑一次查名稱。
   * user／group／role 以外的型別交給 `resolveOther`；沒有提供或它沒回的節點當作讀不到。
   */
  async describePaths(
    actor: AuthUser,
    paths: ReadonlyArray<readonly SubjectKey[]>,
    resolveOther?: ExplainNodeResolver,
  ): Promise<ExplainNodeDto[][]> {
    const all = [...new Set(paths.flat())];
    const parsed = new Map(all.map((key) => [key, parseSubjectKey(key)]));
    const idsOf = (type: string) =>
      [...parsed.values()]
        .filter((node) => node.object.type === type && node.object.id !== '*')
        .map((node) => node.object.id);
    const others = all.filter((key) => {
      const type = parsed.get(key)?.object.type ?? '';
      return !['user', 'group', 'role'].includes(type) && !ALWAYS_VISIBLE_TYPES.has(type);
    });

    const [userNames, groupNames, roleNames, otherNodes, actorSet, actorClosure] =
      await Promise.all([
        this.repo.userNames(idsOf('user')),
        this.repo.groupNames(idsOf('group')),
        this.repo.roleNames(idsOf('role')),
        resolveOther && others.length ? resolveOther(others) : Promise.resolve(new Map()),
        this.permissions.getPermissionSet(actor.id),
        this.authz.closurePaths(actor.id),
      ]);
    const can = (key: PermissionKey) => actorSet.isSuperAdmin || actorSet.permissions.has(key);
    // 操作者直接所屬的群組、直接持有的角色：鏈只有「本人 → 它」兩段
    const direct = new Set(
      [...actorClosure].filter(([, path]) => path.length === 2).map(([key]) => key),
    );

    const describe = (key: SubjectKey): ExplainNodeDto => {
      const { object, relation } = parsed.get(key) ?? parseSubjectKey(key);
      const node = (name: string | null, visible: boolean): ExplainNodeDto =>
        visible
          ? { type: object.type, id: object.id, relation, name, hidden: false }
          : { type: object.type, id: null, relation, name: null, hidden: true };
      switch (object.type) {
        case 'user':
          return node(
            userNames.get(object.id) ?? null,
            object.id === '*' || object.id === actor.id || can(PERMISSION.USER_READ),
          );
        case 'group':
          return node(
            groupNames.get(object.id) ?? null,
            can(PERMISSION.GROUP_READ) || direct.has(key),
          );
        case 'role':
          return node(
            roleNames.get(object.id) ?? null,
            can(PERMISSION.ROLE_READ) || direct.has(key),
          );
        default: {
          if (ALWAYS_VISIBLE_TYPES.has(object.type)) return node(null, true);
          const other = otherNodes.get(key);
          return node(other?.name ?? null, other?.visible ?? false);
        }
      }
    };
    return paths.map((path) => path.map(describe));
  }
}
