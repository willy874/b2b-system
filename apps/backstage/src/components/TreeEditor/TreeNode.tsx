import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { createContext, memo, use } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import type { SlotResolver } from '../slots';
import type { TreeEditorDirection, TreeEditorNode } from './treeGraph';

import styles from './TreeEditor.module.css';

/**
 * 節點的外觀狀態（外框、底色由元件負責）：
 * - `active`：已啟用（技能樹裡學會的技能）
 * - `derived`：由其他節點帶出而成立（例：被上層技能包含），外觀比 `active` 淡
 * - `available`：可以啟用
 * - `locked`：不能操作
 */
export type TreeEditorNodeState = 'active' | 'derived' | 'available' | 'locked';

/** 節點內容由呼叫端決定時拿到的狀態。 */
export interface TreeEditorRenderState {
  selected: boolean;
  readOnly: boolean;
  state: TreeEditorNodeState | undefined;
  highlighted: boolean;
}

/** React Flow 節點的 `data`：原樣帶著呼叫端的節點。 */
export interface TreeFlowNodeData extends Record<string, unknown> {
  source: TreeEditorNode<unknown>;
}

export type TreeFlowNode = Node<TreeFlowNodeData, 'tree'>;

export interface TreeNodeContextValue {
  renderNode:
    | ((node: TreeEditorNode<unknown>, state: TreeEditorRenderState) => ReactNode)
    | undefined;
  getNodeLabel: (node: TreeEditorNode<unknown>) => string;
  readOnly: boolean;
  getNodeState: ((node: TreeEditorNode<unknown>) => TreeEditorNodeState | undefined) | undefined;
  highlightedNodeIds: ReadonlySet<string>;
  /** 沒給 `createNode` 時為 `undefined`，節點上不出現「新增子節點」。 */
  onAddChild: ((parentId: string) => void) | undefined;
  addChildLabel: string;
  direction: TreeEditorDirection;
  slot: SlotResolver<'node' | 'group'>;
}

export const TreeNodeContext = createContext<TreeNodeContextValue | null>(null);

/** 連入（父 → 我）與連出（我 → 子）的把手位置，依排版方向決定。 */
export const HANDLE_POSITIONS = {
  TB: { target: Position.Top, source: Position.Bottom },
  BT: { target: Position.Bottom, source: Position.Top },
  LR: { target: Position.Left, source: Position.Right },
  RL: { target: Position.Right, source: Position.Left },
} as const satisfies Record<TreeEditorDirection, { target: Position; source: Position }>;

/**
 * 畫布上的一個節點。外框、選取狀態、把手與「新增子節點」由元件負責；
 * 框內的內容交給 `renderNode`（沒給時顯示 `getNodeLabel` 的文字）。
 */
export const TreeNode = memo(function TreeNode({ data, selected }: NodeProps<TreeFlowNode>) {
  const context = use(TreeNodeContext);
  if (!context) throw new Error('TreeNode 必須在 TreeEditor 裡使用');
  const {
    renderNode,
    getNodeLabel,
    readOnly,
    getNodeState,
    highlightedNodeIds,
    onAddChild,
    addChildLabel,
    direction,
    slot,
  } = context;
  const node = data.source;
  const handles = HANDLE_POSITIONS[direction];
  const label = getNodeLabel(node);
  const state = getNodeState?.(node);
  const highlighted = highlightedNodeIds.has(node.id);

  return (
    <div
      {...slot('node', styles.node, { testId: 'tree-editor-item' })}
      data-value={node.id}
      data-selected={selected || undefined}
      data-state={state}
      data-highlighted={highlighted || undefined}
      data-direction={direction}
      aria-label={label}
    >
      <Handle
        type="target"
        position={handles.target}
        className={styles.handle}
        isConnectable={!readOnly}
      />
      <div className={styles.nodeContent}>
        {renderNode ? (
          renderNode(node, { selected, readOnly, state, highlighted })
        ) : (
          <span className={styles.nodeLabel}>{label}</span>
        )}
      </div>
      {onAddChild && !readOnly && (
        <button
          type="button"
          // React Flow 以 `nodrag` 排除拖曳，按鈕才點得到
          className={cn('nodrag', styles.addChild)}
          data-side={handles.source}
          aria-label={addChildLabel}
          title={addChildLabel}
          data-testid="tree-editor-add-child"
          data-value={node.id}
          onClick={(event) => {
            event.stopPropagation();
            onAddChild(node.id);
          }}
        >
          <Icon name="plus" size={14} />
        </button>
      )}
      <Handle
        type="source"
        position={handles.source}
        className={styles.handle}
        isConnectable={!readOnly}
      />
    </div>
  );
});

/** 分組背景的 `data`：標題（`TreeEditor` 的 `groups`）。 */
export interface TreeGroupNodeData extends Record<string, unknown> {
  label: string;
}

export type TreeGroupFlowNode = Node<TreeGroupNodeData, 'group'>;

/** 分組背景：不可選、不可拖、不接收滑鼠事件（畫布照常平移）。 */
export const TreeGroupNode = memo(function TreeGroupNode({
  id,
  data,
}: NodeProps<TreeGroupFlowNode>) {
  const context = use(TreeNodeContext);
  if (!context) throw new Error('TreeGroupNode 必須在 TreeEditor 裡使用');
  return (
    <div {...context.slot('group', styles.group, { testId: 'tree-editor-group' })} data-value={id}>
      <span className={styles.groupLabel}>{data.label}</span>
    </div>
  );
});
