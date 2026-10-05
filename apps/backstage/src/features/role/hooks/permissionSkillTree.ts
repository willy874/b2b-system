import type { TreeEditorNodeState } from '@b2b-system/ui/TreeEditor';

import { permissionClosure } from '@/core/permission-graph';
import type { PermissionCatalogGraph } from '@/core/permission-graph';

/**
 * 角色權限技能樹的純邏輯（docs/rbac/02-permission-catalog.md §9 權限依賴樹）：
 * 狀態與互鎖（點上層自動點亮前置、有上層包含時不能取消前置）；閉包、前置路徑與版面在 `core/permission-graph`。
 */

/** 技能樹上一個權限鍵的狀態。 */
export type SkillState =
  /** 明確授予（角色的 `role_permissions`）。 */
  | 'explicit'
  /** 由其他明確的鍵（遞迴）帶出來。 */
  | 'implied'
  /** 沒有，但可以授予。 */
  | 'available'
  /** 沒有，而且操作者自己沒有這個權限（反提權），不能授予。 */
  | 'unavailable';

export const SKILL_NODE_STATE = {
  explicit: 'active',
  implied: 'derived',
  available: 'available',
  unavailable: 'locked',
} as const satisfies Record<SkillState, TreeEditorNodeState>;

type Catalog = PermissionCatalogGraph;

function directlyImplied(catalog: Catalog, key: string): readonly string[] {
  const item = catalog.find((permission) => permission.key === key);
  return item ? [...item.includes, ...item.requires] : [];
}

/** `explicit` 之中（遞迴）帶來 `key` 的鍵，不含 `key` 自己。 */
export function implyingKeys(catalog: Catalog, key: string, explicit: Iterable<string>): string[] {
  return [...explicit].filter(
    (candidate) =>
      candidate !== key && permissionClosure(catalog, directlyImplied(catalog, candidate)).has(key),
  );
}

export function skillState(
  catalog: Catalog,
  key: string,
  explicit: ReadonlySet<string>,
  isGrantable: (key: string) => boolean,
): SkillState {
  if (explicit.has(key)) return 'explicit';
  if (implyingKeys(catalog, key, explicit).length > 0) return 'implied';
  return isGrantable(key) ? 'available' : 'unavailable';
}

export type ToggleResult =
  | { kind: 'changed'; next: Set<string> }
  /** 有上層包含它，不能取消：先取消 `by` 裡的鍵。 */
  | { kind: 'blocked'; by: string[] }
  /** 操作者沒有這個權限，不能授予。 */
  | { kind: 'unavailable' };

/**
 * 點一個節點：
 * - 還沒有 → 點亮（它的前置自動成為「已包含」）；操作者沒有這個權限時不能點亮。
 * - 已有、而且有上層包含它（不論是不是明確的）→ 擋下，先取消上層（技能樹的互鎖）。
 * - 明確的、沒有上層 → 取消；只由它帶出的前置跟著熄滅。
 */
export function toggleSkill(
  catalog: Catalog,
  key: string,
  explicit: ReadonlySet<string>,
  isGrantable: (key: string) => boolean,
): ToggleResult {
  const by = implyingKeys(catalog, key, explicit);
  if (by.length > 0) return { kind: 'blocked', by };
  const next = new Set(explicit);
  if (next.has(key)) {
    next.delete(key);
    return { kind: 'changed', next };
  }
  if (!isGrantable(key)) return { kind: 'unavailable' };
  next.add(key);
  return { kind: 'changed', next };
}

/**
 * 下拉選單一次改了一批鍵（`added`／`removed` 是相對於亮著的鍵）：
 * - 只改一個鍵 → 與點節點相同（`toggleSkill` 的互鎖）。
 * - 勾或取消整個群組 → 取消的鍵全部拿掉（仍被其他明確鍵帶出的，留在「已包含」）；
 *   加入的鍵只留可授予、而且沒被同一批其他鍵帶出的，讓送出的明確鍵維持最少。
 */
export function selectSkills(
  catalog: Catalog,
  explicit: ReadonlySet<string>,
  added: readonly string[],
  removed: readonly string[],
  isGrantable: (key: string) => boolean,
): ToggleResult {
  const changed = [...added, ...removed];
  if (changed.length === 1)
    return toggleSkill(catalog, changed[0] as string, explicit, isGrantable);
  const next = new Set(explicit);
  for (const key of removed) next.delete(key);
  const candidates = added.filter((key) => isGrantable(key));
  for (const key of candidates) next.add(key);
  for (const key of candidates) {
    if (implyingKeys(catalog, key, next).length > 0) next.delete(key);
  }
  return { kind: 'changed', next };
}
