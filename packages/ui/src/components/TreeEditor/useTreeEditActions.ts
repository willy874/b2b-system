import { useReactFlow } from '@xyflow/react';
import type { Connection, Edge, NodeChange, OnBeforeDelete } from '@xyflow/react';
import { useCallback, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useLatestRef } from '../useLatestRef';
import { layoutTree, placeChild, placeRoot } from './layout';
import type { TreeLayoutOptions } from './layout';
import { FIT_VIEW_OPTIONS, isEditableTarget } from './treeEditorFlow';
import type { TreeEditorLayout, TreeEditorProps } from './treeEditorTypes';
import { addNode, checkConnection, connectNodes, moveNodes, removeElements } from './treeGraph';
import type { TreeEditorMode, TreeEditorPosition, TreeEditorValue } from './treeGraph';
import type { TreeFlowNode, TreeGroupFlowNode } from './TreeNode';
import type { useTreeHistory } from './useTreeHistory';
import type { TreeSelection } from './useTreeSelection';

type FlowNode = TreeFlowNode | TreeGroupFlowNode;

export interface TreeEditActionsOptions<TData> extends Pick<
  TreeEditorProps<TData>,
  'createNode' | 'isValidConnection' | 'onBeforeDelete'
> {
  /** 畫面上的值（`auto` 排版過、`manual` 補過座標） */
  display: TreeEditorValue<TData>;
  history: ReturnType<typeof useTreeHistory<TData>>;
  selection: TreeSelection;
  layout: TreeEditorLayout;
  layoutOptions: TreeLayoutOptions;
  mode: TreeEditorMode;
  editable: boolean;
}

/**
 * TreeEditor 的編輯動作：拖曳（放開才寫入一步）、連線、刪除（先問 `onBeforeDelete`）、新增根節點與子節點、
 * 自動排版、縮放與對焦，以及復原／重做、Tab 新增子節點的快捷鍵。每一次寫入都經過 `history.commit`。
 */
export function useTreeEditActions<TData>({
  display,
  history,
  selection,
  layout,
  layoutOptions,
  mode,
  editable,
  createNode,
  isValidConnection,
  onBeforeDelete,
}: TreeEditActionsOptions<TData>) {
  const flow = useReactFlow();
  const [dragPositions, setDragPositions] = useState<ReadonlyMap<string, TreeEditorPosition>>(
    new Map(),
  );
  const { selectedIds, selectedEdgeIds, selectOnly } = selection;

  const handleNodesChange = (changes: NodeChange<FlowNode>[]) => {
    selection.applyNodeChanges(changes);
    let nextDrag: Map<string, TreeEditorPosition> | undefined;
    let dropped = false;
    for (const change of changes) {
      if (change.type !== 'position') continue;
      nextDrag ??= new Map(dragPositions);
      if (change.position) nextDrag.set(change.id, change.position);
      if (change.dragging === false) dropped = true;
      // remove 由 onDelete 一次處理（同一步復原）；尺寸固定為 nodeSize，不需要量測結果
    }
    if (!nextDrag) return;
    if (dropped) {
      setDragPositions(new Map());
      history.commit(moveNodes(display, nextDrag));
    } else {
      setDragPositions(nextDrag);
    }
  };

  const canConnect = (source: string, target: string) =>
    checkConnection(display, source, target, mode) === 'ok' &&
    (isValidConnection?.({ source, target }, display) ?? true);

  const handleConnect = (connection: Connection) => {
    if (!canConnect(connection.source, connection.target)) return;
    history.commit(connectNodes(display, connection.source, connection.target, mode));
  };

  const handleBeforeDelete: OnBeforeDelete<FlowNode> = async ({ nodes, edges }) => {
    if (!editable) return false;
    if (!onBeforeDelete) return true;
    return onBeforeDelete({
      nodeIds: nodes.map((node) => node.id),
      edgeIds: edges.map((edge) => edge.id),
    });
  };

  // onBeforeDelete 可能等使用者確認很久；刪除時以當下最新的值為準
  const latestDisplay = useLatestRef(display);
  const handleDelete = ({ nodes, edges }: { nodes: FlowNode[]; edges: Edge[] }) => {
    history.commit(
      removeElements(
        latestDisplay.current,
        nodes.map((node) => node.id),
        edges.map((edge) => edge.id),
      ),
    );
    selection.clearEdges();
  };

  const addRoot = () => {
    if (!createNode) return;
    const node = createNode({});
    const position = layout === 'manual' ? placeRoot(display, layoutOptions) : undefined;
    history.commit(addNode(display, { ...node, position }));
    selectOnly(node.id);
  };

  const addChild = useLatestRef((parentId: string) => {
    if (!createNode) return;
    const node = createNode({ parentId });
    const position = layout === 'manual' ? placeChild(display, parentId, layoutOptions) : undefined;
    history.commit(addNode(display, { ...node, position }, parentId));
    selectOnly(node.id);
  });
  // 固定參考：放進節點的 context，選取或值改變時節點不必重新渲染
  const handleAddChild = useCallback((parentId: string) => addChild.current(parentId), [addChild]);

  const deleteSelection = () => {
    void flow.deleteElements({
      nodes: selectedIds.map((id) => ({ id })),
      edges: [...selectedEdgeIds].map((id) => ({ id })),
    });
  };

  const fitView = () => void flow.fitView({ ...FIT_VIEW_OPTIONS, duration: 200 });

  const autoLayout = () => {
    history.commit(layoutTree(display, layoutOptions));
    // 等 React Flow 拿到新座標之後再對焦
    requestAnimationFrame(fitView);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editable || isEditableTarget(event.target)) return;
    const isMod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (isMod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) history.redo();
      else history.undo();
    } else if (isMod && key === 'y') {
      event.preventDefault();
      history.redo();
    } else if (event.key === 'Tab' && createNode && selectedIds.length === 1) {
      // 與心智圖工具相同：Tab 在選取的節點底下新增子節點
      event.preventDefault();
      handleAddChild(selectedIds[0] ?? '');
    }
  };

  return {
    dragPositions,
    handleNodesChange,
    canConnect,
    handleConnect,
    handleBeforeDelete,
    handleDelete,
    addRoot,
    handleAddChild,
    deleteSelection,
    fitView,
    autoLayout,
    zoomIn: () => void flow.zoomIn({ duration: 150 }),
    zoomOut: () => void flow.zoomOut({ duration: 150 }),
    handleKeyDown,
  };
}
