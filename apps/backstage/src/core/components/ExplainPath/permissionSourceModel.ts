import type { ExplainNode, PermissionSources } from '@/shared/api-sdk';

export type PermissionSourceItem = PermissionSources['items'][number];

/** 讀不到的角色（後端只回種類，沒有 id）在篩選裡合成一個選項。 */
export const HIDDEN_ROLE = 'hidden';

export interface PermissionSourceGroup {
  resource: string;
  resourceNameI18nKey: string;
  items: PermissionSourceItem[];
}

export interface PermissionSourceRole {
  /** 角色 id；讀不到的角色是 `HIDDEN_ROLE`。 */
  value: string;
  /** 角色名稱；讀不到的角色是 null（由畫面顯示「某個角色」）。 */
  name: string | null;
}

/** 路徑上帶來權限的角色（`role#holder` 節點）。 */
function roleOf(via: readonly ExplainNode[]): PermissionSourceRole | undefined {
  const role = via.findLast((node) => node.type === 'role');
  if (!role) return undefined;
  return role.hidden || !role.id
    ? { value: HIDDEN_ROLE, name: null }
    : { value: role.id, name: role.name };
}

/** 帶來這些權限的所有角色，依第一次出現的順序（後端是目錄順序）。 */
export function rolesOf(items: readonly PermissionSourceItem[]): PermissionSourceRole[] {
  const roles = new Map<string, PermissionSourceRole>();
  for (const item of items) {
    for (const source of item.sources) {
      const role = roleOf(source.via);
      if (role && !roles.has(role.value)) roles.set(role.value, role);
    }
  }
  return [...roles.values()];
}

/** 只由依賴樹帶出（沒有任何角色明確授予這個鍵）。 */
export function isImpliedOnly(item: PermissionSourceItem): boolean {
  return item.sources.every((source) => source.grantedKey !== item.key);
}

interface FilterOptions {
  /** 已轉成小寫、去掉前後空白的關鍵字；空字串表示不過濾。 */
  needle: string;
  /** 只留經由這個角色帶來的權限（`rolesOf` 的 `value`）；undefined 表示不過濾。 */
  role: string | undefined;
  /** 權限的顯示名稱（已翻譯），搜尋同時比對名稱與鍵。 */
  nameOf: (item: PermissionSourceItem) => string;
}

/** 依關鍵字與角色過濾，再依資源分組（組內照後端的目錄順序）。 */
export function filterAndGroup(
  items: readonly PermissionSourceItem[],
  { needle, role, nameOf }: FilterOptions,
): PermissionSourceGroup[] {
  const groups = new Map<string, PermissionSourceGroup>();
  for (const item of items) {
    if (needle && !`${item.key}\n${nameOf(item)}`.toLowerCase().includes(needle)) continue;
    if (role && !item.sources.some((source) => roleOf(source.via)?.value === role)) continue;
    const group = groups.get(item.resource) ?? {
      resource: item.resource,
      resourceNameI18nKey: item.resourceNameI18nKey,
      items: [],
    };
    group.items.push(item);
    groups.set(item.resource, group);
  }
  return [...groups.values()];
}
