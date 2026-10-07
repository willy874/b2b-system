import { cn } from '@b2b-system/web-shared/utils';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { useMemo } from 'react';
import type { CSSProperties } from 'react';

import { Button } from '../Button';
import { Empty } from '../Empty';
import { Icon } from '../Icon';
import { useComponentLabels } from '../labels';
import { createSlots } from '../slots';
import { Toolbar } from '../Toolbar';
import { useControllableState } from '../useControllableState';
import { fillMissingPositions, layoutTree } from './layout';
import type { TreeEditorNodeSize, TreeLayoutOptions } from './layout';
import {
  BACKGROUND_GAP,
  EMPTY_IDS,
  FIT_VIEW_OPTIONS,
  MINIMAP_SIZE,
  NODE_TYPES,
  SNAP_GRID,
  toCssLength,
  toFlowEdges,
  toFlowNodes,
} from './treeEditorFlow';
import { treeEditorToolbarItems } from './treeEditorToolbar';
import type { TreeEditorProps } from './treeEditorTypes';
import { EMPTY_TREE_VALUE } from './treeGraph';
import type { TreeEditorNode, TreeEditorValue } from './treeGraph';
import { TreeNodeContext } from './TreeNode';
import type { TreeFlowNode, TreeGroupFlowNode, TreeNodeContextValue } from './TreeNode';
import { useTreeEditActions } from './useTreeEditActions';
import { useTreeHistory } from './useTreeHistory';
import { useTreeSelection } from './useTreeSelection';

import styles from './TreeEditor.module.css';

export type {
  TreeEditorDeleteRequest,
  TreeEditorEdgeType,
  TreeEditorLabels,
  TreeEditorLayout,
  TreeEditorProps,
  TreeEditorSlot,
} from './treeEditorTypes';

export const DEFAULT_TREE_NODE_SIZE: TreeEditorNodeSize = { width: 180, height: 56 };
export const DEFAULT_TREE_EDITOR_HEIGHT = '32rem';

/**
 * 樹狀圖／分層圖的編輯器：可平移、縮放的畫布上新增、刪除、拖曳節點，
 * 從節點的把手拖到另一個節點建立父子關係，並可一鍵自動排版。
 * 底層是 React Flow（`@xyflow/react`）＋ dagre；資料模型與純函式在 `treeGraph.ts`、排版在 `layout.ts`、
 * 與 React Flow 之間的設定與轉換在 `treeEditorFlow.ts`、工具列在 `treeEditorToolbar.tsx`，
 * 說明見 docs/architecture/frontend/07-ui-system.md §3.13。
 */
export function TreeEditor<TData>(props: TreeEditorProps<TData>) {
  // 每個編輯器各自一份 React Flow store，同頁放兩個也互不干擾
  return (
    <ReactFlowProvider>
      <TreeEditorCanvas {...props} />
    </ReactFlowProvider>
  );
}

function TreeEditorCanvas<TData>({
  ref,
  value: valueProp,
  defaultValue,
  onChange,
  mode = 'tree',
  direction = 'TB',
  layout = 'manual',
  nodeSize = DEFAULT_TREE_NODE_SIZE,
  nodeGap,
  rankGap,
  edgeType = 'smoothstep',
  renderNode,
  getNodeLabel,
  getNodeState,
  highlightedNodeIds = EMPTY_IDS,
  activeEdgeIds = EMPTY_IDS,
  highlightedEdgeIds = EMPTY_IDS,
  groups,
  selectable = true,
  createNode,
  isValidConnection,
  onBeforeDelete,
  onSelectionChange,
  onNodeClick,
  onNodeDoubleClick,
  readOnly = false,
  showMinimap = true,
  height = DEFAULT_TREE_EDITOR_HEIGHT,
  labels: labelsProp,
  className,
  style,
  classNames,
  styles: styleOverrides,
  testIds,
  'aria-label': ariaLabel,
  ...rest
}: TreeEditorProps<TData>) {
  const labels = { ...useComponentLabels().treeEditor, ...labelsProp };
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });

  const [value, setValue] = useControllableState<TreeEditorValue<TData>>(
    valueProp,
    defaultValue ?? EMPTY_TREE_VALUE,
    onChange,
  );
  const history = useTreeHistory(value, setValue);

  const { width: nodeWidth, height: nodeHeight } = nodeSize;
  const layoutOptions = useMemo<TreeLayoutOptions>(
    () => ({ direction, nodeSize: { width: nodeWidth, height: nodeHeight }, nodeGap, rankGap }),
    [direction, nodeWidth, nodeHeight, nodeGap, rankGap],
  );

  // 畫面上的值：`auto` 每次都重排；`manual` 只補上沒有座標的節點。
  // 補上的座標在下一次編輯時才隨著 onChange 寫回，單純顯示不會觸發 onChange。
  const display = useMemo(
    () =>
      layout === 'auto'
        ? layoutTree(value, layoutOptions)
        : fillMissingPositions(value, layoutOptions),
    [layout, value, layoutOptions],
  );

  const selection = useTreeSelection(display.nodes, onSelectionChange);
  const { selectedNodeIds, selectedEdgeIds, selectedIds, hasSelection } = selection;
  const editable = !readOnly;
  const draggable = editable && layout === 'manual';
  const actions = useTreeEditActions({
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
  });
  const { dragPositions, handleAddChild, addRoot } = actions;

  const flowNodes = useMemo(
    () =>
      toFlowNodes(display, {
        dragPositions,
        nodeSize: { width: nodeWidth, height: nodeHeight },
        selectedNodeIds,
        selectable,
        draggable,
        editable,
        groups,
      }),
    [
      display,
      dragPositions,
      nodeWidth,
      nodeHeight,
      selectedNodeIds,
      selectable,
      draggable,
      editable,
      groups,
    ],
  );

  const flowEdges = useMemo(
    () =>
      toFlowEdges(display, {
        edgeType,
        selectedEdgeIds,
        selectable,
        editable,
        activeEdgeIds,
        highlightedEdgeIds,
      }),
    [display, edgeType, selectedEdgeIds, selectable, activeEdgeIds, highlightedEdgeIds, editable],
  );

  const nodeSlot = useMemo(
    () => createSlots<'node' | 'group'>({ classNames, styles: styleOverrides, testIds }),
    [classNames, styleOverrides, testIds],
  );
  const getLabel = getNodeLabel as TreeNodeContextValue['getNodeLabel'] | undefined;
  const getState = getNodeState as TreeNodeContextValue['getNodeState'];
  const nodeContext = useMemo<TreeNodeContextValue>(
    () => ({
      renderNode: renderNode as TreeNodeContextValue['renderNode'],
      getNodeLabel: getLabel ?? ((node) => node.id),
      readOnly,
      getNodeState: getState,
      highlightedNodeIds,
      onAddChild: createNode ? handleAddChild : undefined,
      addChildLabel: labels.addChild,
      direction,
      slot: nodeSlot,
    }),
    [
      renderNode,
      getLabel,
      readOnly,
      getState,
      highlightedNodeIds,
      createNode,
      handleAddChild,
      labels.addChild,
      direction,
      nodeSlot,
    ],
  );

  const isEmpty = display.nodes.length === 0;

  const toolbarItems = treeEditorToolbarItems({
    labels,
    editable,
    canCreate: Boolean(createNode),
    layout,
    selectedIds,
    hasSelection,
    isEmpty,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    onAddRoot: addRoot,
    onAddChild: handleAddChild,
    onDelete: actions.deleteSelection,
    onAutoLayout: actions.autoLayout,
    onUndo: history.undo,
    onRedo: history.redo,
    onZoomOut: actions.zoomOut,
    onZoomIn: actions.zoomIn,
    onFitView: actions.fitView,
  });

  return (
    // 快捷鍵（復原、Tab 新增）是從裡面可聚焦的節點與按鈕冒泡上來的，外層本身不可互動
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={ref}
      className={cn(styles.root, className)}
      style={{ '--tree-editor-height': toCssLength(height), ...style } as CSSProperties}
      data-readonly={readOnly || undefined}
      data-mode={mode}
      onKeyDown={actions.handleKeyDown}
      {...rest}
    >
      <div {...slot('toolbar', styles.toolbar, { testId: 'tree-editor-toolbar' })}>
        <Toolbar items={toolbarItems} iconOnly moreLabel={labels.more} />
      </div>

      <TreeNodeContext value={nodeContext}>
        <section
          aria-label={ariaLabel}
          {...slot('canvas', styles.canvas, { testId: 'tree-editor-canvas' })}
        >
          <ReactFlow<TreeFlowNode | TreeGroupFlowNode>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={actions.handleNodesChange}
            onEdgesChange={selection.applyEdgeChanges}
            onConnect={actions.handleConnect}
            isValidConnection={(edge) => actions.canConnect(edge.source, edge.target)}
            onBeforeDelete={actions.handleBeforeDelete}
            onDelete={actions.handleDelete}
            // 一定要給：React Flow 對「不可選、不可拖、不可連、也沒有點擊處理」的節點設 pointer-events: none，
            // selectable={false} 時節點內的按鈕就點不到
            onNodeClick={(_, node) => {
              if (node.type === 'tree') onNodeClick?.(node.data.source as TreeEditorNode<TData>);
            }}
            onNodeDoubleClick={(_, node) => {
              if (node.type === 'tree')
                onNodeDoubleClick?.(node.data.source as TreeEditorNode<TData>);
            }}
            nodesDraggable={draggable}
            nodesConnectable={editable}
            elementsSelectable={selectable}
            nodesFocusable={selectable}
            edgesFocusable={selectable}
            deleteKeyCode={editable ? ['Delete', 'Backspace'] : null}
            snapToGrid
            snapGrid={SNAP_GRID}
            minZoom={0.2}
            maxZoom={2}
            fitView
            fitViewOptions={FIT_VIEW_OPTIONS}
            // MIT 授權允許移除；後台介面不顯示第三方浮水印
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={BACKGROUND_GAP} size={1} />
            {showMinimap && !isEmpty && (
              <MiniMap
                pannable
                zoomable
                {...slot('minimap', styles.minimap, {
                  testId: 'tree-editor-minimap',
                  style: MINIMAP_SIZE,
                })}
              />
            )}
          </ReactFlow>
          {isEmpty && (
            <Empty
              title={labels.empty}
              action={
                editable && createNode ? (
                  <Button size="sm" startIcon={<Icon name="plus" size={16} />} onClick={addRoot}>
                    {labels.addRoot}
                  </Button>
                ) : undefined
              }
              {...slot('empty', styles.empty, { testId: 'tree-editor-empty' })}
            />
          )}
        </section>
      </TreeNodeContext>
    </div>
  );
}
