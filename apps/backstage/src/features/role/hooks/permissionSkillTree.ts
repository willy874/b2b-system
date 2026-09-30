import { computeTreeLayout, getEdgeId } from '@/components/TreeEditor';
import type {
  TreeEditorEdge,
  TreeEditorGroup,
  TreeEditorNode,
  TreeEditorNodeState,
  TreeEditorNodeSize,
  TreeEditorPosition,
} from '@/components/TreeEditor';
import type { Permission, PermissionGroup } from '@/shared/api-sdk';

/**
 * 角色權限技能樹的純邏輯（docs/rbac/02-permission-catalog.md §9 權限依賴樹）：
 * 狀態、互鎖（點上層自動點亮前置、有上層包含時不能取消前置）與版面。元件只把結果畫出來。
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

type Catalog = readonly Pick<Permission, 'key' | 'includes' | 'requires'>[];

function directlyImplied(catalog: Catalog, key: string): readonly string[] {
  const item = catalog.find((permission) => permission.key === key);
  return item ? [...item.includes, ...item.requires] : [];
}

/** 閉包：這些鍵加上它們（遞迴）帶來的所有鍵。 */
export function permissionClosure(catalog: Catalog, keys: Iterable<string>): Set<string> {
  const result = new Set<string>();
  const stack = [...keys];
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (result.has(key)) continue;
    result.add(key);
    stack.push(...directlyImplied(catalog, key));
  }
  return result;
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

/** 滑過某個節點時要強調的前置（遞迴，不含自己）與通往它的連線。 */
export function prerequisitePath(
  catalog: Catalog,
  key: string,
  edges: readonly TreeEditorEdge[],
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = permissionClosure(catalog, directlyImplied(catalog, key));
  nodeIds.delete(key);
  const within = new Set([...nodeIds, key]);
  const edgeIds = new Set(
    edges
      .filter((edge) => within.has(edge.source) && within.has(edge.target))
      .map((edge) => getEdgeId(edge)),
  );
  return { nodeIds, edgeIds };
}

/** 兩端都亮著（明確或已包含）的連線：已學會的路徑。 */
export function activeEdgeIds(
  edges: readonly TreeEditorEdge[],
  lit: ReadonlySet<string>,
): Set<string> {
  return new Set(
    edges
      .filter((edge) => lit.has(edge.source) && lit.has(edge.target))
      .map((edge) => getEdgeId(edge)),
  );
}

export interface SkillNodeData {
  key: string;
  resource: string;
  nameI18nKey: string;
}

export interface SkillTreeLayout {
  nodes: TreeEditorNode<SkillNodeData>[];
  /** 由前置指向上層；跨資源的依賴是虛線。 */
  edges: TreeEditorEdge[];
  groups: TreeEditorGroup[];
}

export const SKILL_NODE_SIZE: TreeEditorNodeSize = { width: 148, height: 44 };

/** 同一列的分組超過這個寬度就換列（px）。 */
const ROW_WIDTH = 1080;
/** 分組之間的距離：要容納分組背景的留白與標題列（layout.ts 的 GROUP_PADDING、GROUP_LABEL_HEIGHT）。 */
const GROUP_GAP_X = 64;
const GROUP_GAP_Y = 88;

/**
 * 技能樹的版面：每個資源一組，組內以子能力分層（基礎在下、`BT`），各組依目錄順序由左到右排、放不下就換列。
 * 跨資源的依賴畫成虛線，不參與組內排版。`groupLabel` 把資源的語系鍵換成顯示名稱。
 */
export function layoutSkillTree(
  items: readonly Permission[],
  groups: readonly PermissionGroup[],
  groupLabel: (group: PermissionGroup) => string,
): SkillTreeLayout {
  const byKey = new Map(items.map((item) => [item.key as string, item]));
  const nodes: TreeEditorNode<SkillNodeData>[] = [];
  const edges: TreeEditorEdge[] = [];
  const treeGroups: TreeEditorGroup[] = [];

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const group of groups) {
    const members = group.keys.flatMap((key) => {
      const item = byKey.get(key);
      return item ? [item] : [];
    });
    if (members.length === 0) continue;
    const memberKeys = new Set(members.map((item) => item.key as string));
    const inner: TreeEditorEdge[] = members.flatMap((item) =>
      item.includes
        .filter((target) => memberKeys.has(target))
        .map((target) => ({ source: target as string, target: item.key as string })),
    );
    const positions = computeTreeLayout(
      { nodes: members.map((item) => ({ id: item.key as string, data: null })), edges: inner },
      { direction: 'BT', nodeSize: SKILL_NODE_SIZE, nodeGap: 20, rankGap: 40 },
    );
    const placed = [...positions.values()];
    const minX = Math.min(...placed.map((p) => p.x));
    const minY = Math.min(...placed.map((p) => p.y));
    const width = Math.max(...placed.map((p) => p.x)) - minX + SKILL_NODE_SIZE.width;
    const height = Math.max(...placed.map((p) => p.y)) - minY + SKILL_NODE_SIZE.height;

    if (cursorX > 0 && cursorX + width > ROW_WIDTH) {
      cursorX = 0;
      cursorY += rowHeight + GROUP_GAP_Y;
      rowHeight = 0;
    }
    for (const item of members) {
      const position = positions.get(item.key) as TreeEditorPosition;
      nodes.push({
        id: item.key,
        data: { key: item.key, resource: item.resource, nameI18nKey: item.nameI18nKey },
        position: { x: cursorX + position.x - minX, y: cursorY + position.y - minY },
      });
    }
    edges.push(...inner);
    treeGroups.push({ id: group.resource, label: groupLabel(group), nodeIds: [...memberKeys] });
    cursorX += width + GROUP_GAP_X;
    rowHeight = Math.max(rowHeight, height);
  }

  // 跨資源的依賴（只指向 read）：虛線
  const present = new Set(nodes.map((node) => node.id));
  for (const item of items) {
    for (const target of item.requires) {
      if (present.has(item.key) && present.has(target)) {
        edges.push({ source: target, target: item.key, variant: 'dashed' });
      }
    }
  }
  return { nodes, edges, groups: treeGroups };
}
