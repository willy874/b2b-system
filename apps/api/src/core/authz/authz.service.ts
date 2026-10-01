import { Injectable } from '@nestjs/common';

import { ALL_PERMISSION_KEYS, isPermissionKey, permissionClosure } from '@/db/seeds/permissions';
import type { PermissionKey } from '@/db/seeds/permissions';

import type { DbOrTx } from '../database';
import { createChecker, objectKey, subjectKey } from './authz.checker';
import type { AuthzChecker, ObjectRef, SubjectKey } from './authz.checker';
import { capabilitiesOf, isUsersetRelation } from './authz.model';
import { AuthzRegistry } from './authz.registry';
import { AuthzRepository } from './authz.repository';
import { createSnapshot } from './authz.snapshot';
import type { EdgeProvider, TupleEntry } from './authz.snapshot';
import { SUPER_ADMIN_RELATION, TENANT_OBJECT, tenantEdgeProvider } from './authz.types';

export interface ResolveOptions {
  /** 權限依賴樹是否生效（G1 影子比對：false；G2 起：true）。 */
  withDependencies: boolean;
  tx?: DbOrTx;
  now?: Date;
}

/** 一位使用者在租戶節點上的權限。 */
export interface TenantPermissions {
  /** 直接授予的鍵（角色帶的權限鍵的邊），不含依賴樹帶來的。 */
  explicit: Set<PermissionKey>;
  /** 成立的權限關係；`withDependencies` 時含依賴樹的閉包。super-admin 不展開（呼叫端判斷 `isSuperAdmin`）。 */
  effective: Set<PermissionKey>;
  isSuperAdmin: boolean;
  /** 主體閉包：解析資源（資料夾…）時沿用，不必再查一次。 */
  subjects: SubjectKey[];
}

/** 物件上的一個關係（反提權：要授予的、要比對的）。 */
export interface RelationRef {
  object: ObjectRef;
  relation: string;
}

/**
 * 以關係圖解析權限（docs/adr/0024-relationship-based-access-control.md）。
 * 資料來自 `relation_tuples`；結構邊（資料夾的上層…）由呼叫端以供應者傳入。
 */
@Injectable()
export class AuthzService {
  constructor(
    private readonly registry: AuthzRegistry,
    private readonly repo: AuthzRepository,
  ) {}

  async tenantPermissions(userId: string, options: ResolveOptions): Promise<TenantPermissions> {
    const result = await this.tenantPermissionsOf([userId], options);
    return result.get(userId) as TenantPermissions;
  }

  /**
   * 多人一次解析：主體閉包一條查詢、租戶節點上的 tuple 一條查詢，再逐人在記憶體判斷。
   * 回傳的 Map 含每個傳入的 id。
   */
  async tenantPermissionsOf(
    userIds: readonly string[],
    options: ResolveOptions,
  ): Promise<Map<string, TenantPermissions>> {
    const now = options.now ?? new Date();
    const closures = await this.repo.subjectClosures(userIds, now, options.tx);
    const allSubjects = [...new Set([...closures.values()].flat())];
    const tuples = await this.repo.tuplesForSubjects(
      TENANT_OBJECT.type,
      allSubjects,
      now,
      options.tx,
    );
    const model = this.registry.model(options.withDependencies);

    const result = new Map<string, TenantPermissions>();
    for (const [userId, subjects] of closures) {
      const own = new Set(subjects);
      const mine = tuples.filter((tuple) => own.has(tuple.subject));
      const checker = createChecker(model, createSnapshot(subjects, mine, [tenantEdgeProvider]));
      const explicit = new Set<PermissionKey>();
      for (const tuple of mine) {
        if (isPermissionKey(tuple.relation)) explicit.add(tuple.relation);
      }
      const isSuperAdmin = mine.some((tuple) => tuple.relation === SUPER_ADMIN_RELATION);
      // super-admin 讓每個權限關係都成立：這裡不展開成全集（呼叫端看 isSuperAdmin），與舊的 PermissionSet 形狀一致
      const effective = isSuperAdmin
        ? options.withDependencies
          ? permissionClosure(explicit)
          : new Set(explicit)
        : new Set(ALL_PERMISSION_KEYS.filter((key) => checker.check(TENANT_OBJECT, key)));
      result.set(userId, { explicit, effective, isSuperAdmin, subjects });
    }
    return result;
  }

  /**
   * 在租戶節點上持有 `relations` 其中任一個的使用者（反向解析的候選，見 `AuthzRepository.usersWithTenantRelations`）。
   * 呼叫端要自己展開「哪些關係會讓目標成立」（權限鍵、帶來它的鍵、superAdmin），並以正向解析確認結果。
   */
  usersWithTenantRelations(
    relations: readonly string[],
    options: { now?: Date; tx?: DbOrTx } = {},
  ): Promise<string[]> {
    return this.repo.usersWithTenantRelations(relations, options.now ?? new Date(), options.tx);
  }

  /**
   * 建立一位操作者的判斷器：`objectTypes` 上的 tuple（與租戶節點上的）一次載入，
   * `providers` 供應結構邊。`subjects` 通常來自 `tenantPermissions`。
   */
  async checkerFor(
    subjects: readonly SubjectKey[],
    objectTypes: readonly string[],
    providers: readonly EdgeProvider[],
    options: ResolveOptions,
  ): Promise<AuthzChecker> {
    const now = options.now ?? new Date();
    const tuples: TupleEntry[] = [];
    for (const type of [TENANT_OBJECT.type, ...objectTypes]) {
      // oxlint-disable-next-line no-await-in-loop -- 同一個交易的查詢依序執行
      tuples.push(...(await this.repo.tuplesForSubjects(type, subjects, now, options.tx)));
    }
    return this.checker(subjects, tuples, providers, options.withDependencies);
  }

  /** 一位使用者的主體閉包，每個主體附上從本人走到它的鏈（說明用，`AuthzRepository.closurePaths`）。 */
  closurePaths(
    userId: string,
    options: { tx?: DbOrTx; now?: Date } = {},
  ): Promise<Map<SubjectKey, SubjectKey[]>> {
    return this.repo.closurePaths(userId, options.now ?? new Date(), options.tx);
  }

  /**
   * 使用者在租戶節點上 **直接** 取得的每一條邊（說明用）：關係（權限鍵或 `superAdmin`）＋ 從本人到那個主體的鏈
   * （例：`[user:u, group:g#member, role:r#holder]` 帶來 `file:update`）。依賴樹帶出的鍵由呼叫端以閉包推出。
   */
  async tenantSourcesOf(
    userId: string,
    options: { tx?: DbOrTx; now?: Date } = {},
  ): Promise<Array<{ relation: string; path: SubjectKey[] }>> {
    const now = options.now ?? new Date();
    const closure = await this.repo.closurePaths(userId, now, options.tx);
    const tuples = await this.repo.tuplesForSubjects(
      TENANT_OBJECT.type,
      [...closure.keys()],
      now,
      options.tx,
    );
    return tuples.map((tuple) => ({
      relation: tuple.relation,
      path: closure.get(tuple.subject) ?? [tuple.subject],
    }));
  }

  /**
   * 反提權（docs/adr/0024-relationship-based-access-control.md G4）：把某個主體放進 `targets` 的每一個 `物件#關係`，
   * 主體因此取得的能力。操作者必須全部都有（呼叫端以自己的判斷器或權限集合比對）。
   *
   * - 關係本身是能力，或靜態蘊含能力（租戶上的權限鍵、資料夾等級）：同一個物件上的那些能力（`capabilitiesOf`）。
   * - 使用者集合（`role:<r>#holder`、`group:<g>#member`）：沿成員關係往上的閉包裡，每個集合在 **租戶節點** 上的能力——
   *   角色的權限鍵（含 `superAdmin`）、群組與上層群組持有的角色的鍵。不含它們在資料夾上的授權（D13：那些授權在授予給
   *   這個集合時已經檢查過一次）。
   *
   * 結果依 `targets` 的順序去重。
   */
  async grantedCapabilities(
    targets: readonly RelationRef[],
    options: { tx?: DbOrTx; now?: Date } = {},
  ): Promise<RelationRef[]> {
    const model = this.registry.model(true);
    const result = new Map<string, RelationRef>();
    const add = (object: ObjectRef, relation: string) =>
      result.set(`${objectKey(object)}#${relation}`, { object, relation });

    const usersets: SubjectKey[] = [];
    for (const target of targets) {
      if (isUsersetRelation(model, target.object.type, target.relation)) {
        usersets.push(subjectKey(target.object.type, target.object.id, target.relation));
      } else {
        for (const capability of capabilitiesOf(model, target.object.type, target.relation)) {
          add(target.object, capability);
        }
      }
    }
    if (usersets.length) {
      const now = options.now ?? new Date();
      const closures = await this.repo.usersetClosures(usersets, now, options.tx);
      const reachable = [...new Set([...closures.values()].flat())];
      const tuples = await this.repo.tuplesForSubjects(
        TENANT_OBJECT.type,
        reachable,
        now,
        options.tx,
      );
      const tenantCapabilities = new Set(model.types.get(TENANT_OBJECT.type)?.capabilities ?? []);
      for (const tuple of tuples) {
        if (tenantCapabilities.has(tuple.relation)) add(TENANT_OBJECT, tuple.relation);
      }
    }
    return [...result.values()];
  }

  private checker(
    subjects: readonly SubjectKey[],
    tuples: readonly TupleEntry[],
    providers: readonly EdgeProvider[],
    withDependencies: boolean,
  ): AuthzChecker {
    const snapshot = createSnapshot(subjects, tuples, [tenantEdgeProvider, ...providers]);
    return createChecker(this.registry.model(withDependencies), snapshot);
  }
}
