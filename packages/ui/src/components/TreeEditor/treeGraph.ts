/**
 * `TreeEditor` 的資料模型與純函式：不依賴 React、React Flow，可以直接單元測試，
 * 也可以讓 `features/` 在畫布外（例如屬性面板、匯入）操作同一份資料。
 */

export interface TreeEditorPosition {
  x: number;
  y: number;
}

export interface TreeEditorNode<TData = unknown> {
  /** 在同一份 `value` 內唯一；會成為 `data-value`。 */
  id: string;
  /** 呼叫端自己的資料（技能的名稱、等級、花費…），元件只原樣保存。 */
  data: TData;
  /** 節點左上角在畫布上的座標；沒有時由自動排版決定。 */
  position?: TreeEditorPosition;
}

/** 連線的外觀：`solid`（預設）或 `dashed`（例：技能樹裡「需要、但不屬於同一支」的關係）。 */
export type TreeEditorEdgeVariant = 'solid' | 'dashed';

/** 由 `source`（父、前置）指向 `target`（子、後續）。 */
export interface TreeEditorEdge {
  source: string;
  target: string;
  /** 只影響外觀；元件原樣保存。 */
  variant?: TreeEditorEdgeVariant;
}

export interface TreeEditorValue<TData = unknown> {
  nodes: readonly TreeEditorNode<TData>[];
  edges: readonly TreeEditorEdge[];
}

/**
 * - `tree`：每個節點最多一個父節點；連到已經有父節點的節點時，取代原本那條連線（等於「換父節點」）。
 * - `dag`：可以有多個父節點（技能樹的「需要 A 與 B」），但不能形成循環。
 */
export type TreeEditorMode = 'tree' | 'dag';

/** 根節點在哪一邊：`TB` 上→下、`BT` 下→上（技能樹常見）、`LR` 左→右、`RL` 右→左。 */
export type TreeEditorDirection = 'TB' | 'BT' | 'LR' | 'RL';

/** 連線被拒絕的原因；`ok` 表示可以連。 */
export type TreeEditorConnectionCheck = 'ok' | 'self' | 'missing' | 'duplicate' | 'cycle';

export const EMPTY_TREE_VALUE: TreeEditorValue<never> = { nodes: [], edges: [] };

/** 連線的識別字（React Flow 的 edge id、React `key`）。 */
export function getEdgeId(edge: TreeEditorEdge): string {
  return `${edge.source}->${edge.target}`;
}

/** 從 `from` 沿著連線方向走得到 `to` 嗎？迴圈走訪，深的樹不會爆堆疊。 */
function isReachable(edges: readonly TreeEditorEdge[], from: string, to: string): boolean {
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    const list = children.get(edge.source);
    if (list) list.push(edge.target);
    else children.set(edge.source, [edge.target]);
  }
  const visited = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(children.get(current) ?? []));
  }
  return false;
}

/**
 * 檢查 `source → target` 能不能連。
 * `tree` 模式下目標已經有父節點不算錯誤（`connectNodes` 會取代它），
 * 但取代後仍不能形成循環，所以循環檢查要先拿掉目標原本的父連線。
 */
export function checkConnection(
  value: TreeEditorValue<unknown>,
  source: string,
  target: string,
  mode: TreeEditorMode,
): TreeEditorConnectionCheck {
  if (source === target) return 'self';
  const ids = new Set(value.nodes.map((node) => node.id));
  if (!ids.has(source) || !ids.has(target)) return 'missing';
  if (value.edges.some((edge) => edge.source === source && edge.target === target)) {
    return 'duplicate';
  }
  const edges =
    mode === 'tree' ? value.edges.filter((edge) => edge.target !== target) : value.edges;
  return isReachable(edges, target, source) ? 'cycle' : 'ok';
}

/** 加一條連線；不合法時回傳原本的 `value`（同一個參考）。 */
export function connectNodes<TData>(
  value: TreeEditorValue<TData>,
  source: string,
  target: string,
  mode: TreeEditorMode,
): TreeEditorValue<TData> {
  if (checkConnection(value, source, target, mode) !== 'ok') return value;
  const kept = mode === 'tree' ? value.edges.filter((edge) => edge.target !== target) : value.edges;
  return { nodes: value.nodes, edges: [...kept, { source, target }] };
}

/** 加一個節點；有 `parentId` 時同時連上父節點。 */
export function addNode<TData>(
  value: TreeEditorValue<TData>,
  node: TreeEditorNode<TData>,
  parentId?: string,
): TreeEditorValue<TData> {
  const nodes = [...value.nodes, node];
  const edges =
    parentId === undefined ? value.edges : [...value.edges, { source: parentId, target: node.id }];
  return { nodes, edges };
}

/**
 * 刪除節點與連線。刪掉的節點上的連線一併移除；它的子節點保留、變成根節點
 * （要整棵子樹一起刪，先用 `getDescendantIds` 把子孫加進 `nodeIds`）。
 */
export function removeElements<TData>(
  value: TreeEditorValue<TData>,
  nodeIds: Iterable<string>,
  edgeIds: Iterable<string> = [],
): TreeEditorValue<TData> {
  const removedNodes = new Set(nodeIds);
  const removedEdges = new Set(edgeIds);
  return {
    nodes: value.nodes.filter((node) => !removedNodes.has(node.id)),
    edges: value.edges.filter(
      (edge) =>
        !removedNodes.has(edge.source) &&
        !removedNodes.has(edge.target) &&
        !removedEdges.has(getEdgeId(edge)),
    ),
  };
}

/** 更新節點座標（拖曳結束時一次寫回）。 */
export function moveNodes<TData>(
  value: TreeEditorValue<TData>,
  positions: ReadonlyMap<string, TreeEditorPosition>,
): TreeEditorValue<TData> {
  if (positions.size === 0) return value;
  return {
    nodes: value.nodes.map((node) => {
      const position = positions.get(node.id);
      return position ? { ...node, position } : node;
    }),
    edges: value.edges,
  };
}

/** 更新某個節點的 `data`（屬性面板改名稱、等級時用）。 */
export function updateNodeData<TData>(
  value: TreeEditorValue<TData>,
  id: string,
  update: (data: TData) => TData,
): TreeEditorValue<TData> {
  return {
    nodes: value.nodes.map((node) =>
      node.id === id ? { ...node, data: update(node.data) } : node,
    ),
    edges: value.edges,
  };
}

/** 沒有父節點的節點。 */
export function getRootIds(value: TreeEditorValue<unknown>): string[] {
  const hasParent = new Set(value.edges.map((edge) => edge.target));
  return value.nodes.filter((node) => !hasParent.has(node.id)).map((node) => node.id);
}

/** 某個節點的所有父節點（`dag` 模式可能不只一個）。 */
export function getParentIds(value: TreeEditorValue<unknown>, id: string): string[] {
  return value.edges.filter((edge) => edge.target === id).map((edge) => edge.source);
}

/** 某個節點底下的所有子孫（不含自己），依廣度優先的順序。 */
export function getDescendantIds(value: TreeEditorValue<unknown>, id: string): string[] {
  const result: string[] = [];
  const visited = new Set([id]);
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const edge of value.edges) {
      if (edge.source !== current || visited.has(edge.target)) continue;
      visited.add(edge.target);
      result.push(edge.target);
      queue.push(edge.target);
    }
  }
  return result;
}
