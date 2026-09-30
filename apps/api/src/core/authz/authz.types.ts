import type { PermissionDependencyMap } from '@/db/seeds/permissions';
import {
  ALL_PERMISSION_KEYS,
  directlyImplied,
  PERMISSION_DEPENDENCIES,
} from '@/db/seeds/permissions';

import { computed, defineType, direct, union } from './authz.model';
import type { Rewrite, TypeDefinition } from './authz.model';
import type { EdgeProvider } from './authz.snapshot';

/** 每個租戶 DB 只有一個租戶節點（docs/features/permission-graph.md §1）。 */
export const TENANT_OBJECT = { type: 'tenant', id: 'self' } as const;

/** super-admin 在租戶節點上的關係：目錄產生的每個權限關係都含它（隱含全集）。 */
export const SUPER_ADMIN_RELATION = 'superAdmin';

/** 使用者集合「角色的持有者」：`role:<id>#holder`。 */
export const ROLE_HOLDER_RELATION = 'holder';

export const USER_TYPE: TypeDefinition = defineType('user', {});

export const ROLE_TYPE: TypeDefinition = defineType('role', {
  [ROLE_HOLDER_RELATION]: direct('user'),
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
  return defineType(TENANT_OBJECT.type, relations);
}

/** 每個物件都有一條隱含的 `tenant` 邊指向租戶節點（不存）。 */
export const tenantEdgeProvider: EdgeProvider = (_object, relation) =>
  relation === 'tenant' ? [`${TENANT_OBJECT.type}:${TENANT_OBJECT.id}`] : undefined;
