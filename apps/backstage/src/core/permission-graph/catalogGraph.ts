import { computeTreeLayout, getEdgeId } from '@b2b-system/ui/TreeEditor';
import type {
  TreeEditorEdge,
  TreeEditorGroup,
  TreeEditorNode,
  TreeEditorNodeSize,
  TreeEditorPosition,
} from '@b2b-system/ui/TreeEditor';

import type { Permission, PermissionGroup } from '@/shared/api-sdk';

/**
 * 權限依賴樹（docs/rbac/02-permission-catalog.md §9）的純邏輯：閉包、前置路徑與畫布版面。
 * 角色權限的技能樹（可勾選）與權限目錄的樹狀圖（唯讀）共用同一份版面。
 */

export type PermissionCatalogGraph = readonly Pick<Permission, 'key' | 'includes' | 'requires'>[];

function directlyImplied(catalog: PermissionCatalogGraph, key: string): readonly string[] {
  const item = catalog.find((permission) => permission.key === key);
  return item ? [...item.includes, ...item.requires] : [];
}

/** 閉包：這些鍵加上它們（遞迴）帶來的所有鍵。 */
export function permissionClosure(
  catalog: PermissionCatalogGraph,
  keys: Iterable<string>,
): Set<string> {
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

/** 直接（不遞迴）包含或依賴 `key` 的鍵：子能力的上層與依賴它的鍵。 */
export function dependentKeys(catalog: PermissionCatalogGraph, key: string): string[] {
  return catalog
    .filter((item) => [...item.includes, ...item.requires].some((target) => target === key))
    .map((item) => item.key as string);
}

/** 滑過某個節點時要強調的前置（遞迴，不含自己）與通往它的連線。 */
export function prerequisitePath(
  catalog: PermissionCatalogGraph,
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

/** 兩端都亮著（明確或已包含）的連線：已學會（技能樹）或已持有（權限目錄）的路徑。 */
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

export interface PermissionNodeData {
  key: string;
  resource: string;
  nameI18nKey: string;
}

export interface PermissionTreeLayout {
  nodes: TreeEditorNode<PermissionNodeData>[];
  /** 由前置指向上層；跨資源的依賴是虛線。 */
  edges: TreeEditorEdge[];
  groups: TreeEditorGroup[];
}

export const PERMISSION_NODE_SIZE: TreeEditorNodeSize = { width: 148, height: 44 };

/** 同一列的分組超過這個寬度就換列（px）。 */
const ROW_WIDTH = 1080;
/** 分組之間的距離：要容納分組背景的留白與標題列（layout.ts 的 GROUP_PADDING、GROUP_LABEL_HEIGHT）。 */
const GROUP_GAP_X = 64;
const GROUP_GAP_Y = 88;

/**
 * 依賴樹的版面：每個資源一組，組內以子能力分層（基礎在上、由上而下讀，`TB`），各組依目錄順序由左到右排、放不下就換列。
 * 跨資源的依賴畫成虛線，不參與組內排版。`groupLabel` 把資源的語系鍵換成顯示名稱。
 */
export function layoutPermissionTree(
  items: readonly Permission[],
  groups: readonly PermissionGroup[],
  groupLabel: (group: PermissionGroup) => string,
): PermissionTreeLayout {
  const byKey = new Map(items.map((item) => [item.key as string, item]));
  const nodes: TreeEditorNode<PermissionNodeData>[] = [];
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
      { direction: 'TB', nodeSize: PERMISSION_NODE_SIZE, nodeGap: 20, rankGap: 40 },
    );
    const placed = [...positions.values()];
    const minX = Math.min(...placed.map((p) => p.x));
    const minY = Math.min(...placed.map((p) => p.y));
    const width = Math.max(...placed.map((p) => p.x)) - minX + PERMISSION_NODE_SIZE.width;
    const height = Math.max(...placed.map((p) => p.y)) - minY + PERMISSION_NODE_SIZE.height;

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
