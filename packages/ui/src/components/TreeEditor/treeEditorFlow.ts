import { cn } from '@b2b-system/web-shared/utils';
import type { Edge } from '@xyflow/react';
import type { CSSProperties } from 'react';

import { computeGroupBounds } from './layout';
import type { TreeEditorGroup, TreeEditorNodeSize } from './layout';
import type { TreeEditorEdgeType } from './treeEditorTypes';
import { getEdgeId } from './treeGraph';
import type { TreeEditorNode, TreeEditorPosition, TreeEditorValue } from './treeGraph';
import { TreeGroupNode, TreeNode } from './TreeNode';
import type { TreeFlowNode, TreeGroupFlowNode } from './TreeNode';

import styles from './TreeEditor.module.css';

/*
 * TreeEditor 與 React Flow 之間的設定與轉換：節點類型、連線樣式、對齊格線、對焦選項，
 * 以及畫面上的值 → React Flow 的節點與連線。元件（`TreeEditor.tsx`）只處理 props 與狀態同步。
 */
export const NODE_TYPES = { tree: TreeNode, group: TreeGroupNode };

export const EMPTY_IDS: ReadonlySet<string> = new Set();

const EDGE_TYPE = {
  smoothstep: 'smoothstep',
  bezier: 'default',
  straight: 'straight',
} as const satisfies Record<TreeEditorEdgeType, string>;

/** 拖曳時對齊的格線（px）；與背景點陣的間距一致。 */
export const SNAP_GRID: [number, number] = [8, 8];
export const BACKGROUND_GAP = 16;

/** 對焦時不放大超過原尺寸：節點少時才不會大到像是另一個元件。 */
export const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.15 };

const ORIGIN: TreeEditorPosition = { x: 0, y: 0 };

/** React Flow 預設 200 × 150，在 32rem 高的畫布裡會蓋住太多節點。 */
export const MINIMAP_SIZE: CSSProperties = { width: 160, height: 112 };

export function toCssLength(value: CSSProperties['height']): string | undefined {
  return typeof value === 'number' ? `${value}px` : value;
}

/** 焦點在呼叫端 `renderNode` 裡的輸入框時，快捷鍵交還給輸入框。 */
export function isEditableTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

export interface FlowNodeOptions {
  /** 拖曳中、還沒放開的座標 */
  dragPositions: ReadonlyMap<string, TreeEditorPosition>;
  nodeSize: TreeEditorNodeSize;
  selectedNodeIds: ReadonlySet<string>;
  selectable: boolean;
  draggable: boolean;
  editable: boolean;
  groups: readonly TreeEditorGroup[] | undefined;
}

/** 畫面上的值 → React Flow 的節點；有分組時先放分組背景（React Flow 依陣列順序繪製，才會在節點底下）。 */
export function toFlowNodes<TData>(
  display: TreeEditorValue<TData>,
  {
    dragPositions,
    nodeSize,
    selectedNodeIds,
    selectable,
    draggable,
    editable,
    groups,
  }: FlowNodeOptions,
): Array<TreeFlowNode | TreeGroupFlowNode> {
  const { width: nodeWidth, height: nodeHeight } = nodeSize;
  const positionOf = (node: TreeEditorNode<TData>) =>
    dragPositions.get(node.id) ?? node.position ?? ORIGIN;
  const treeNodes: TreeFlowNode[] = display.nodes.map((node) => ({
    id: node.id,
    type: 'tree',
    position: positionOf(node),
    data: { source: node },
    width: nodeWidth,
    height: nodeHeight,
    selected: selectable && selectedNodeIds.has(node.id),
    selectable,
    draggable,
    connectable: editable,
    deletable: editable,
  }));
  if (!groups?.length) return treeNodes;
  const bounds = computeGroupBounds(
    new Map(display.nodes.map((node) => [node.id, positionOf(node)])),
    groups,
    { width: nodeWidth, height: nodeHeight },
  );
  const groupNodes: TreeGroupFlowNode[] = bounds.map((group) => ({
    id: group.id,
    type: 'group',
    position: { x: group.x, y: group.y },
    data: { label: group.label },
    width: group.width,
    height: group.height,
    selectable: false,
    draggable: false,
    connectable: false,
    deletable: false,
    focusable: false,
    // 在連線底下：React Flow 的連線圖層排在節點圖層之前，背景不壓低就會蓋住組內的連線
    zIndex: -1,
  }));
  return [...groupNodes, ...treeNodes];
}

export interface FlowEdgeOptions {
  edgeType: TreeEditorEdgeType;
  selectedEdgeIds: ReadonlySet<string>;
  selectable: boolean;
  editable: boolean;
  activeEdgeIds: ReadonlySet<string>;
  highlightedEdgeIds: ReadonlySet<string>;
}

/** 畫面上的值 → React Flow 的連線（id 是 `getEdgeId(edge)`，外觀以 class 表達）。 */
export function toFlowEdges<TData>(
  display: TreeEditorValue<TData>,
  {
    edgeType,
    selectedEdgeIds,
    selectable,
    editable,
    activeEdgeIds,
    highlightedEdgeIds,
  }: FlowEdgeOptions,
): Edge[] {
  return display.edges.map((edge) => {
    const id = getEdgeId(edge);
    return {
      id,
      source: edge.source,
      target: edge.target,
      type: EDGE_TYPE[edgeType],
      className: cn(
        edge.variant === 'dashed' && styles.edgeDashed,
        activeEdgeIds.has(id) && styles.edgeActive,
        highlightedEdgeIds.has(id) && styles.edgeHighlighted,
      ),
      selected: selectable && selectedEdgeIds.has(id),
      selectable,
      focusable: selectable,
      deletable: editable,
    };
  });
}
