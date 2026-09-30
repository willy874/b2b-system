import { Graph, layout } from '@dagrejs/dagre';

import type { TreeEditorDirection, TreeEditorPosition, TreeEditorValue } from './treeGraph';

export interface TreeEditorNodeSize {
  width: number;
  height: number;
}

export interface TreeLayoutOptions {
  direction: TreeEditorDirection;
  nodeSize: TreeEditorNodeSize;
  /** 同一層節點之間的距離（px）。 */
  nodeGap?: number;
  /** 相鄰兩層之間的距離（px）。 */
  rankGap?: number;
}

export const DEFAULT_NODE_GAP = 40;
export const DEFAULT_RANK_GAP = 72;

/**
 * 以 dagre（分層排版，Sugiyama）計算每個節點左上角的座標。
 * `tree` 與 `dag` 共用：多個父節點時 dagre 會把節點放在比所有父節點都深的那一層，並盡量減少交叉。
 * dagre 回傳的是節點中心點，React Flow 的 `position` 是左上角，這裡換算。
 */
export function computeTreeLayout(
  value: TreeEditorValue<unknown>,
  {
    direction,
    nodeSize,
    nodeGap = DEFAULT_NODE_GAP,
    rankGap = DEFAULT_RANK_GAP,
  }: TreeLayoutOptions,
): Map<string, TreeEditorPosition> {
  const graph = new Graph();
  graph.setGraph({ rankdir: direction, nodesep: nodeGap, ranksep: rankGap });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of value.nodes) {
    graph.setNode(node.id, { width: nodeSize.width, height: nodeSize.height });
  }
  for (const edge of value.edges) graph.setEdge(edge.source, edge.target);
  layout(graph);

  const positions = new Map<string, TreeEditorPosition>();
  for (const node of value.nodes) {
    const { x, y } = graph.node(node.id) as { x: number; y: number };
    positions.set(node.id, { x: x - nodeSize.width / 2, y: y - nodeSize.height / 2 });
  }
  return positions;
}

/** 整份重新排版：每個節點都換成自動排版的座標。 */
export function layoutTree<TData>(
  value: TreeEditorValue<TData>,
  options: TreeLayoutOptions,
): TreeEditorValue<TData> {
  const positions = computeTreeLayout(value, options);
  return {
    nodes: value.nodes.map((node) => ({ ...node, position: positions.get(node.id) })),
    edges: value.edges,
  };
}

/**
 * 只替「沒有座標」的節點決定位置，已經擺好的節點不動。
 * 新節點的位置取自整份排版，所以可能與手動擺過的節點重疊；需要整齊時按「自動排版」。
 */
export function fillMissingPositions<TData>(
  value: TreeEditorValue<TData>,
  options: TreeLayoutOptions,
): TreeEditorValue<TData> {
  if (value.nodes.every((node) => node.position)) return value;
  const positions = computeTreeLayout(value, options);
  return {
    nodes: value.nodes.map((node) =>
      node.position ? node : { ...node, position: positions.get(node.id) },
    ),
    edges: value.edges,
  };
}

/**
 * 新子節點的位置：放在父節點往「層」的方向下一層；已經有子節點時接在最外側那個的旁邊，
 * 不必整份重排就不會蓋在父節點或兄弟節點上。父節點沒有座標時回傳 `undefined`（交給 `fillMissingPositions`）。
 */
export function placeChild(
  value: TreeEditorValue<unknown>,
  parentId: string,
  {
    direction,
    nodeSize,
    nodeGap = DEFAULT_NODE_GAP,
    rankGap = DEFAULT_RANK_GAP,
  }: TreeLayoutOptions,
): TreeEditorPosition | undefined {
  const positions = new Map(value.nodes.map((node) => [node.id, node.position]));
  const parent = positions.get(parentId);
  if (!parent) return undefined;
  const isVertical = direction === 'TB' || direction === 'BT';
  const cross = (position: TreeEditorPosition) => (isVertical ? position.x : position.y);
  const siblingCross = value.edges
    .filter((edge) => edge.source === parentId)
    .flatMap((edge) => {
      const position = positions.get(edge.target);
      return position ? [cross(position)] : [];
    });
  const crossStep = (isVertical ? nodeSize.width : nodeSize.height) + nodeGap;
  const crossAt = siblingCross.length > 0 ? Math.max(...siblingCross) + crossStep : cross(parent);
  const sign = direction === 'TB' || direction === 'LR' ? 1 : -1;
  const rankStep = (isVertical ? nodeSize.height : nodeSize.width) + rankGap;
  return isVertical
    ? { x: crossAt, y: parent.y + sign * rankStep }
    : { x: parent.x + sign * rankStep, y: crossAt };
}

/** 新根節點的位置：接在既有節點的「同一層方向」最外側，避免疊在其他樹上。 */
export function placeRoot(
  value: TreeEditorValue<unknown>,
  { direction, nodeSize, nodeGap = DEFAULT_NODE_GAP }: TreeLayoutOptions,
): TreeEditorPosition {
  const placed = value.nodes.flatMap((node) => (node.position ? [node.position] : []));
  if (placed.length === 0) return { x: 0, y: 0 };
  const isVertical = direction === 'TB' || direction === 'BT';
  if (isVertical) {
    const x = Math.max(...placed.map((position) => position.x)) + nodeSize.width + nodeGap;
    const y =
      direction === 'TB'
        ? Math.min(...placed.map((p) => p.y))
        : Math.max(...placed.map((p) => p.y));
    return { x, y };
  }
  const y = Math.max(...placed.map((position) => position.y)) + nodeSize.height + nodeGap;
  const x =
    direction === 'LR' ? Math.min(...placed.map((p) => p.x)) : Math.max(...placed.map((p) => p.x));
  return { x, y };
}
