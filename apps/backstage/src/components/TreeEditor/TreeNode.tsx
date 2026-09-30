import { Handle, Position } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { createContext, memo, use } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import { Icon } from '../Icon';
import type { SlotResolver } from '../slots';
import type { TreeEditorDirection, TreeEditorNode } from './treeGraph';

import styles from './TreeEditor.module.css';

/** 節點內容由呼叫端決定時拿到的狀態。 */
export interface TreeEditorRenderState {
  selected: boolean;
  readOnly: boolean;
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
  /** 沒給 `createNode` 時為 `undefined`，節點上不出現「新增子節點」。 */
  onAddChild: ((parentId: string) => void) | undefined;
  addChildLabel: string;
  direction: TreeEditorDirection;
  slot: SlotResolver<'node'>;
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
  const { renderNode, getNodeLabel, readOnly, onAddChild, addChildLabel, direction, slot } =
    context;
  const node = data.source;
  const handles = HANDLE_POSITIONS[direction];
  const label = getNodeLabel(node);

  return (
    <div
      {...slot('node', styles.node, { testId: 'tree-editor-item' })}
      data-value={node.id}
      data-selected={selected || undefined}
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
          renderNode(node, { selected, readOnly })
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
