import { GRANT_LEVELS } from '@/db/schema';
import type { GrantLevel } from '@/db/schema';

/**
 * 資料夾授權的等級規則（docs/rbac/07-resource-grants.md §2、§3.3、§6.1）。
 * 「等級蘊含哪些動作」由關係圖的靜態蘊含算出（`FileAccessService.levelActions`），這裡只有等級的全序、
 * 反提權的比對方式與繼承鏈——G3 之前在 `modules/resource-grant`，解析併入關係圖之後只剩檔案管理器用。
 */
export type LevelActions<Action extends string> = Record<GrantLevel, readonly Action[]>;

/** 資料夾結構中解析繼承用的欄位。 */
export interface HierarchyNode {
  id: string;
  /** null 是最上層（上面沒有可以繼承的節點）。 */
  parentId: string | null;
  /** false = 中斷繼承：上層的授權不再流到這個節點與它的子孫。 */
  inheritGrants: boolean;
}

/** 等級的全序位置；越大越高。 */
export function levelRank(level: GrantLevel): number {
  return GRANT_LEVELS.indexOf(level);
}

/** 兩個等級取高者；null 是「無」。 */
export function maxLevel(a: GrantLevel | null, b: GrantLevel | null): GrantLevel | null {
  if (a === null) return b;
  if (b === null) return a;
  return levelRank(a) >= levelRank(b) ? a : b;
}

/**
 * 反提權（§6.1）：授予、變更或移除這些等級時，它們蘊含、而操作者沒有的動作。
 * `can` 是操作者在該資料夾上的能力（全域權限 ∪ 資料夾等級）；結果依 `order` 排序，錯誤訊息穩定。
 */
export function missingActions<Action extends string>(
  levels: LevelActions<Action>,
  granted: readonly GrantLevel[],
  order: readonly Action[],
  can: (action: Action) => boolean,
): Action[] {
  const required = new Set(granted.flatMap((level) => levels[level]));
  return order.filter((action) => required.has(action) && !can(action));
}

/** 操作者授予得起的等級：每個等級蘊含的動作操作者都有。 */
export function assignableLevels<Action extends string>(
  levels: LevelActions<Action>,
  order: readonly Action[],
  can: (action: Action) => boolean,
): GrantLevel[] {
  return GRANT_LEVELS.filter((level) => missingActions(levels, [level], order, can).length === 0);
}

/**
 * 節點的「繼承鏈」：自己、上層、…，走到第一個中斷繼承的節點（含）或最上層為止。
 * 這條鏈上的授權就是會流到這個節點的全部授權（授權清單、中斷繼承時複製）。
 */
export function inheritanceChain(nodes: ReadonlyMap<string, HierarchyNode>, id: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = nodes.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current.id);
    if (!current.inheritGrants || !current.parentId) break;
    current = nodes.get(current.parentId);
  }
  return chain;
}
