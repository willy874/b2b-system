import {
  GROUP_MEMBER_RELATION,
  GROUP_OBJECT_TYPE,
  ROLE_HOLDER_RELATION,
  SUPER_ADMIN_RELATION,
  TENANT_OBJECT_ID,
  TENANT_OBJECT_TYPE,
} from '@/db/schema';
import type { PermissionDependencyMap } from '@/db/seeds/permissions';
import {
  ALL_PERMISSION_KEYS,
  directlyImplied,
  PERMISSION_DEPENDENCIES,
} from '@/db/seeds/permissions';

import { computed, defineType, direct, union } from './authz.model';
import type { Rewrite, TypeDefinition } from './authz.model';
import type { EdgeProvider } from './authz.snapshot';

export {
  GROUP_MEMBER_RELATION,
  GROUP_OBJECT_TYPE,
  ROLE_HOLDER_RELATION,
  SUPER_ADMIN_RELATION,
} from '@/db/schema';

/**
 * 主體閉包的深度上限：使用者 → 巢狀群組 → 角色。群組的巢狀層數由寫入端限制在 `GROUP_MAX_NESTING_DEPTH`，
 * 閉包永遠走得完；這裡的上限只防資料異常。
 */
export const MAX_CLOSURE_DEPTH = 8;

/**
 * 群組巢狀的最多層數（一條「群組在群組裡」的鏈上最多幾個群組）。`user → 群組 × N → role` 要在
 * `MAX_CLOSURE_DEPTH` 之內，留一層餘裕；寫入成員時超過就拒絕（`GROUP_NESTING_TOO_DEEP`）。
 */
export const GROUP_MAX_NESTING_DEPTH = MAX_CLOSURE_DEPTH - 2;

/** 每個租戶 DB 只有一個租戶節點（docs/architecture/iam/01-model.md §6.4）。 */
export const TENANT_OBJECT = { type: TENANT_OBJECT_TYPE, id: TENANT_OBJECT_ID } as const;

export const USER_TYPE: TypeDefinition = defineType('user', {});

/**
 * 群組是核心型別（與角色同屬「使用者集合」）：主體閉包的遞迴 CTE 要知道哪些關係是成員關係、
 * 已刪除的節點看哪張表，這在 core 裡（authz.repository.ts），所以型別也定義在這裡而不是由模組註冊。
 * 成員可以是另一個群組的成員（巢狀；寫入時擋循環，docs/architecture/iam/01-model.md §9.3 D11）。
 */
export const GROUP_TYPE: TypeDefinition = defineType(GROUP_OBJECT_TYPE, {
  [GROUP_MEMBER_RELATION]: direct('user', `${GROUP_OBJECT_TYPE}#${GROUP_MEMBER_RELATION}`),
});

/** 角色的持有者：使用者，或群組的成員（D12：super-admin 不能由群組持有，由 service 擋）。 */
export const ROLE_TYPE: TypeDefinition = defineType('role', {
  [ROLE_HOLDER_RELATION]: direct('user', `${GROUP_OBJECT_TYPE}#${GROUP_MEMBER_RELATION}`),
});

export interface TenantTypeOptions {
  /**
   * 權限依賴樹（子能力／依賴）是否算進權限關係。G1 影子比對時關閉：
   * 舊的解析沒有閉包，開著會讓 `file:update` 因為 `file:delete` 而成立，與舊結果不同。
   */
  withDependencies: boolean;
  keys?: readonly string[];
  dependencies?: PermissionDependencyMap;
}

/**
 * 由權限目錄產生租戶型別：一個權限鍵一個關係，定義是
 * 「直接授予（角色的持有者）∪ superAdmin ∪（開啟時）直接帶來它的鍵」。
 */
export function buildTenantType({
  withDependencies,
  keys = ALL_PERMISSION_KEYS,
  dependencies = PERMISSION_DEPENDENCIES,
}: TenantTypeOptions): TypeDefinition {
  const implying = new Map<string, string[]>(keys.map((key) => [key, []]));
  if (withDependencies) {
    for (const key of keys) {
      for (const target of directlyImplied(key as never, dependencies)) {
        implying.get(target)?.push(key);
      }
    }
  }
  const relations: Record<string, Rewrite> = {
    [SUPER_ADMIN_RELATION]: direct(`role#${ROLE_HOLDER_RELATION}`),
  };
  for (const key of keys) {
    relations[key] = union(
      direct(`role#${ROLE_HOLDER_RELATION}`),
      computed(SUPER_ADMIN_RELATION),
      ...(implying.get(key) ?? []).map((source) => computed(source)),
    );
  }
  // 能力（反提權比對的關係）：每個權限鍵與 superAdmin——指派 super-admin 角色等於給出 superAdmin，只有 super-admin 自己有
  return defineType(TENANT_OBJECT.type, relations, {
    capabilities: [SUPER_ADMIN_RELATION, ...keys],
  });
}

/** 每個物件都有一條隱含的 `tenant` 邊指向租戶節點（不存）。 */
export const tenantEdgeProvider: EdgeProvider = (_object, relation) =>
  relation === 'tenant' ? [`${TENANT_OBJECT.type}:${TENANT_OBJECT.id}`] : undefined;
