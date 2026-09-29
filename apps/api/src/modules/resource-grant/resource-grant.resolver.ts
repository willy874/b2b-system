import { GRANT_LEVELS } from '@/db/schema';
import type { GrantLevel } from '@/db/schema';

/**
 * 通用的等級解析（docs/rbac/07-resource-grants.md §3、§10.1）：只認識「節點、上層、是否繼承」，
 * 不認識資料夾。資料夾、未來的專案都把自己的上層鏈轉成 `HierarchyNode` 交給它。
 */
export interface HierarchyNode {
  id: string;
  /** null 是最上層（上面沒有可以繼承的節點）。 */
  parentId: string | null;
  /** false = 中斷繼承：上層的授權不再流到這個節點與它的子孫。 */
  inheritGrants: boolean;
}

/** 對某個節點的一筆授權（對象已經過濾成「操作者本人或他持有的角色」）。 */
export interface LevelGrant {
  resourceId: string;
  level: GrantLevel;
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
 * 回傳 `levelOf(id)`：節點的有效等級＝自己的直接授權與（繼承時）上層有效等級取高者。
 * 以記憶化逐節點計算，整棵樹只走一次；不存在的節點是 null。
 */
export function resolveHierarchyLevels(
  nodes: Iterable<HierarchyNode>,
  grants: Iterable<LevelGrant>,
): (id: string) => GrantLevel | null {
  const byId = new Map<string, HierarchyNode>();
  for (const node of nodes) byId.set(node.id, node);
  const direct = new Map<string, GrantLevel>();
  for (const grant of grants) {
    const previous = direct.get(grant.resourceId);
    const higher = previous && levelRank(previous) >= levelRank(grant.level);
    direct.set(grant.resourceId, higher ? previous : grant.level);
  }

  const memo = new Map<string, GrantLevel | null>();
  const levelOf = (id: string): GrantLevel | null => {
    if (memo.has(id)) return memo.get(id) ?? null;
    // 先走到最近一個已知的節點，再由上往下填：深度有上限，但不依賴遞迴
    const pending: HierarchyNode[] = [];
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !memo.has(current.id) && !seen.has(current.id)) {
      seen.add(current.id);
      pending.push(current);
      current = current.inheritGrants && current.parentId ? byId.get(current.parentId) : undefined;
    }
    for (const node of pending.toReversed()) {
      const inherited =
        node.inheritGrants && node.parentId ? (memo.get(node.parentId) ?? null) : null;
      memo.set(node.id, maxLevel(direct.get(node.id) ?? null, inherited));
    }
    return memo.get(id) ?? null;
  };
  return levelOf;
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
