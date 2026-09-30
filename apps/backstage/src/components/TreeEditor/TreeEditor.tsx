import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, Edge, EdgeChange, NodeChange, OnBeforeDelete } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode, Ref } from 'react';

import { cn } from '@/shared/utils';

import { Button, IconButton } from '../Button';
import { Empty } from '../Empty';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Tooltip } from '../Tooltip';
import { useControllableState } from '../useControllableState';
import { useLatestRef } from '../useLatestRef';
import { fillMissingPositions, layoutTree, placeChild, placeRoot } from './layout';
import type { TreeEditorNodeSize, TreeLayoutOptions } from './layout';
import {
  addNode,
  checkConnection,
  connectNodes,
  EMPTY_TREE_VALUE,
  getEdgeId,
  moveNodes,
  removeElements,
} from './treeGraph';
import type {
  TreeEditorDirection,
  TreeEditorEdge,
  TreeEditorMode,
  TreeEditorNode,
  TreeEditorPosition,
  TreeEditorValue,
} from './treeGraph';
import { TreeNode, TreeNodeContext } from './TreeNode';
import type { TreeEditorRenderState, TreeFlowNode, TreeNodeContextValue } from './TreeNode';
import { useTreeHistory } from './useTreeHistory';

import styles from './TreeEditor.module.css';

/** `className` / `data-testid` 落在最外層；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type TreeEditorSlot = 'toolbar' | 'canvas' | 'node' | 'minimap' | 'empty';

/**
 * - `manual`：節點可以拖曳，座標存在 `value` 裡（技能樹這類需要擺位置的）。
 * - `auto`：每次結構改變都重新排版，節點不能拖（組織圖、目錄這類只在乎結構的）。
 */
export type TreeEditorLayout = 'manual' | 'auto';

export type TreeEditorEdgeType = 'smoothstep' | 'bezier' | 'straight';

export interface TreeEditorLabels {
  addRoot?: string;
  addChild?: string;
  deleteSelection?: string;
  autoLayout?: string;
  fitView?: string;
  zoomIn?: string;
  zoomOut?: string;
  undo?: string;
  redo?: string;
  /** 沒有任何節點時的標題。 */
  empty?: string;
}

export interface TreeEditorDeleteRequest {
  nodeIds: string[];
  edgeIds: string[];
}

export interface TreeEditorProps<TData> extends SlotOverrides<TreeEditorSlot> {
  /** 透傳到最外層（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /** 受控的值；每一次編輯（新增、刪除、連線、拖曳放開、排版、復原）以 `onChange` 回報一整份新值。 */
  value?: TreeEditorValue<TData>;
  defaultValue?: TreeEditorValue<TData>;
  onChange?: (value: TreeEditorValue<TData>) => void;
  /** 預設 `tree`（單一父節點）；技能樹「需要 A 與 B」用 `dag`。 */
  mode?: TreeEditorMode;
  /** 預設 `TB`（根在上）。 */
  direction?: TreeEditorDirection;
  /** 預設 `manual`。 */
  layout?: TreeEditorLayout;
  /** 每個節點的尺寸（px），排版與畫布都用它；預設 180 × 56。 */
  nodeSize?: TreeEditorNodeSize;
  /** 同一層節點之間的距離（px），預設 40。 */
  nodeGap?: number;
  /** 相鄰兩層之間的距離（px），預設 72。 */
  rankGap?: number;
  /** 連線的樣式，預設 `smoothstep`（直角轉折）。 */
  edgeType?: TreeEditorEdgeType;
  /** 節點框內的內容；沒給時顯示 `getNodeLabel` 的文字。 */
  renderNode?: (node: TreeEditorNode<TData>, state: TreeEditorRenderState) => ReactNode;
  /** 節點的名稱（預設內容與報讀器用），預設是 `id`。 */
  getNodeLabel?: (node: TreeEditorNode<TData>) => string;
  /**
   * 建立新節點（不必給 `position`）。沒給時工具列與節點上不出現「新增」。
   * `parentId` 是要接在哪個節點底下；新增根節點時為 `undefined`。
   */
  createNode?: (context: { parentId?: string }) => TreeEditorNode<TData>;
  /** 額外的連線規則（例如限制層數）；自己連自己、重複、循環已經由元件擋下。 */
  isValidConnection?: (edge: TreeEditorEdge, value: TreeEditorValue<TData>) => boolean;
  /** 刪除前確認（例如 `useConfirm()`）；回傳 `false` 取消。刪節點時 `edgeIds` 含它身上的連線。 */
  onBeforeDelete?: (request: TreeEditorDeleteRequest) => boolean | Promise<boolean>;
  /** 選取的節點改變時通知（例如在旁邊的屬性面板編輯它）。 */
  onSelectionChange?: (nodeIds: string[]) => void;
  onNodeDoubleClick?: (node: TreeEditorNode<TData>) => void;
  /** 只能看、平移與縮放，不能改。 */
  readOnly?: boolean;
  /** 右下角的小地圖，預設顯示。 */
  showMinimap?: boolean;
  /** 畫布高度，預設 `32rem`。 */
  height?: CSSProperties['height'];
  /** 預設文案是繁中；`features/` 使用時以 `t()` 傳入。 */
  labels?: TreeEditorLabels;
  className?: string;
  style?: CSSProperties;
  /** 畫布的名稱。 */
  'aria-label'?: string;
  'data-testid'?: string;
}

const DEFAULT_LABELS: Required<TreeEditorLabels> = {
  addRoot: '新增根節點',
  addChild: '新增子節點',
  deleteSelection: '刪除選取',
  autoLayout: '自動排版',
  fitView: '顯示全部',
  zoomIn: '放大',
  zoomOut: '縮小',
  undo: '復原',
  redo: '重做',
  empty: '還沒有任何節點',
};

export const DEFAULT_TREE_NODE_SIZE: TreeEditorNodeSize = { width: 180, height: 56 };
export const DEFAULT_TREE_EDITOR_HEIGHT = '32rem';

const NODE_TYPES = { tree: TreeNode };

const EDGE_TYPE = {
  smoothstep: 'smoothstep',
  bezier: 'default',
  straight: 'straight',
} as const satisfies Record<TreeEditorEdgeType, string>;

/** 拖曳時對齊的格線（px）；與背景點陣的間距一致。 */
const SNAP_GRID: [number, number] = [8, 8];
const BACKGROUND_GAP = 16;

/** 對焦時不放大超過原尺寸：節點少時才不會大到像是另一個元件。 */
const FIT_VIEW_OPTIONS = { maxZoom: 1, padding: 0.15 };

const ORIGIN: TreeEditorPosition = { x: 0, y: 0 };

/** React Flow 預設 200 × 150，在 32rem 高的畫布裡會蓋住太多節點。 */
const MINIMAP_SIZE: CSSProperties = { width: 160, height: 112 };

function toCssLength(value: CSSProperties['height']): string | undefined {
  return typeof value === 'number' ? `${value}px` : value;
}

/** 焦點在呼叫端 `renderNode` 裡的輸入框時，快捷鍵交還給輸入框。 */
function isEditableTarget(target: EventTarget): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

interface ToolbarButtonProps {
  label: string;
  icon: IconName;
  action: string;
  onClick: () => void;
  disabled?: boolean;
}

function ToolbarButton({ label, icon, action, onClick, disabled }: ToolbarButtonProps) {
  return (
    <Tooltip content={label}>
      <IconButton
        size="sm"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        data-testid="tree-editor-action"
        data-value={action}
      >
        <Icon name={icon} size={16} />
      </IconButton>
    </Tooltip>
  );
}

/**
 * 樹狀圖／分層圖的編輯器：可平移、縮放的畫布上新增、刪除、拖曳節點，
 * 從節點的把手拖到另一個節點建立父子關係，並可一鍵自動排版。
 * 底層是 React Flow（`@xyflow/react`）＋ dagre；資料模型與純函式在 `treeGraph.ts`，
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
  createNode,
  isValidConnection,
  onBeforeDelete,
  onSelectionChange,
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
  const labels = { ...DEFAULT_LABELS, ...labelsProp };
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const flow = useReactFlow();

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

  const [selectedNodeIds, setSelectedNodeIds] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<ReadonlySet<string>>(new Set());
  const [dragPositions, setDragPositions] = useState<ReadonlyMap<string, TreeEditorPosition>>(
    new Map(),
  );

  // 刪除或復原之後，選取裡可能留著已經不存在的節點
  const existingNodeIds = useMemo(() => new Set(display.nodes.map((node) => node.id)), [display]);
  const selectedIds = useMemo(
    () => [...selectedNodeIds].filter((id) => existingNodeIds.has(id)),
    [selectedNodeIds, existingNodeIds],
  );
  // 以字串比較：換一份 value 時 selectedIds 是新陣列，但選取沒變就不通知
  const selectionKey = selectedIds.join('\n');
  const notifiedSelection = useRef(selectionKey);
  const latestOnSelectionChange = useLatestRef(onSelectionChange);
  useEffect(() => {
    if (notifiedSelection.current === selectionKey) return;
    notifiedSelection.current = selectionKey;
    latestOnSelectionChange.current?.(selectionKey === '' ? [] : selectionKey.split('\n'));
  }, [selectionKey, latestOnSelectionChange]);

  const editable = !readOnly;
  const draggable = editable && layout === 'manual';

  const flowNodes = useMemo<TreeFlowNode[]>(
    () =>
      display.nodes.map((node) => ({
        id: node.id,
        type: 'tree',
        position: dragPositions.get(node.id) ?? node.position ?? ORIGIN,
        data: { source: node },
        width: nodeWidth,
        height: nodeHeight,
        selected: selectedNodeIds.has(node.id),
        draggable,
        connectable: editable,
        deletable: editable,
      })),
    [display, dragPositions, nodeWidth, nodeHeight, selectedNodeIds, draggable, editable],
  );

  const flowEdges = useMemo<Edge[]>(
    () =>
      display.edges.map((edge) => {
        const id = getEdgeId(edge);
        return {
          id,
          source: edge.source,
          target: edge.target,
          type: EDGE_TYPE[edgeType],
          selected: selectedEdgeIds.has(id),
          deletable: editable,
        };
      }),
    [display, edgeType, selectedEdgeIds, editable],
  );

  const handleNodesChange = (changes: NodeChange<TreeFlowNode>[]) => {
    let nextSelection: Set<string> | undefined;
    let nextDrag: Map<string, TreeEditorPosition> | undefined;
    let dropped = false;
    for (const change of changes) {
      if (change.type === 'select') {
        nextSelection ??= new Set(selectedNodeIds);
        if (change.selected) nextSelection.add(change.id);
        else nextSelection.delete(change.id);
      } else if (change.type === 'position') {
        nextDrag ??= new Map(dragPositions);
        if (change.position) nextDrag.set(change.id, change.position);
        if (change.dragging === false) dropped = true;
      }
      // remove 由 onDelete 一次處理（同一步復原）；尺寸固定為 nodeSize，不需要量測結果
    }
    if (nextSelection) setSelectedNodeIds(nextSelection);
    if (!nextDrag) return;
    if (dropped) {
      setDragPositions(new Map());
      history.commit(moveNodes(display, nextDrag));
    } else {
      setDragPositions(nextDrag);
    }
  };

  const handleEdgesChange = (changes: EdgeChange[]) => {
    let next: Set<string> | undefined;
    for (const change of changes) {
      if (change.type !== 'select') continue;
      next ??= new Set(selectedEdgeIds);
      if (change.selected) next.add(change.id);
      else next.delete(change.id);
    }
    if (next) setSelectedEdgeIds(next);
  };

  const canConnect = (source: string, target: string) =>
    checkConnection(display, source, target, mode) === 'ok' &&
    (isValidConnection?.({ source, target }, display) ?? true);

  const handleConnect = (connection: Connection) => {
    if (!canConnect(connection.source, connection.target)) return;
    history.commit(connectNodes(display, connection.source, connection.target, mode));
  };

  const handleBeforeDelete: OnBeforeDelete<TreeFlowNode> = async ({ nodes, edges }) => {
    if (!editable) return false;
    if (!onBeforeDelete) return true;
    return onBeforeDelete({
      nodeIds: nodes.map((node) => node.id),
      edgeIds: edges.map((edge) => edge.id),
    });
  };

  // onBeforeDelete 可能等使用者確認很久；刪除時以當下最新的值為準
  const latestDisplay = useLatestRef(display);
  const handleDelete = ({ nodes, edges }: { nodes: TreeFlowNode[]; edges: Edge[] }) => {
    history.commit(
      removeElements(
        latestDisplay.current,
        nodes.map((node) => node.id),
        edges.map((edge) => edge.id),
      ),
    );
    setSelectedEdgeIds(new Set());
  };

  const selectOnly = (id: string) => {
    setSelectedNodeIds(new Set([id]));
    setSelectedEdgeIds(new Set());
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

  const nodeSlot = useMemo(
    () => createSlots<'node'>({ classNames, styles: styleOverrides, testIds }),
    [classNames, styleOverrides, testIds],
  );
  const getLabel = getNodeLabel as TreeNodeContextValue['getNodeLabel'] | undefined;
  const nodeContext = useMemo<TreeNodeContextValue>(
    () => ({
      renderNode: renderNode as TreeNodeContextValue['renderNode'],
      getNodeLabel: getLabel ?? ((node) => node.id),
      readOnly,
      onAddChild: createNode ? handleAddChild : undefined,
      addChildLabel: labels.addChild,
      direction,
      slot: nodeSlot,
    }),
    [
      renderNode,
      getLabel,
      readOnly,
      createNode,
      handleAddChild,
      labels.addChild,
      direction,
      nodeSlot,
    ],
  );

  const hasSelection = selectedIds.length > 0 || selectedEdgeIds.size > 0;
  const isEmpty = display.nodes.length === 0;

  return (
    // 快捷鍵（復原、Tab 新增）是從裡面可聚焦的節點與按鈕冒泡上來的，外層本身不可互動
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={ref}
      className={cn(styles.root, className)}
      style={{ '--tree-editor-height': toCssLength(height), ...style } as CSSProperties}
      data-readonly={readOnly || undefined}
      data-mode={mode}
      onKeyDown={handleKeyDown}
      {...rest}
    >
      <div {...slot('toolbar', styles.toolbar, { testId: 'tree-editor-toolbar' })}>
        {editable && createNode && (
          <>
            <ToolbarButton label={labels.addRoot} icon="plus" action="add-root" onClick={addRoot} />
            <ToolbarButton
              label={labels.addChild}
              icon="folder-plus"
              action="add-child"
              onClick={() => {
                const [parentId] = selectedIds;
                if (parentId !== undefined) handleAddChild(parentId);
              }}
              disabled={selectedIds.length !== 1}
            />
          </>
        )}
        {editable && (
          <ToolbarButton
            label={labels.deleteSelection}
            icon="trash"
            action="delete"
            onClick={deleteSelection}
            disabled={!hasSelection}
          />
        )}
        {editable && layout === 'manual' && (
          <ToolbarButton
            label={labels.autoLayout}
            icon="network"
            action="auto-layout"
            onClick={autoLayout}
            disabled={isEmpty}
          />
        )}
        <span className={styles.toolbarEnd}>
          {editable && (
            <>
              <ToolbarButton
                label={labels.undo}
                icon="undo"
                action="undo"
                onClick={history.undo}
                disabled={!history.canUndo}
              />
              <ToolbarButton
                label={labels.redo}
                icon="redo"
                action="redo"
                onClick={history.redo}
                disabled={!history.canRedo}
              />
            </>
          )}
          <ToolbarButton
            label={labels.zoomOut}
            icon="zoom-out"
            action="zoom-out"
            onClick={() => void flow.zoomOut({ duration: 150 })}
          />
          <ToolbarButton
            label={labels.zoomIn}
            icon="zoom-in"
            action="zoom-in"
            onClick={() => void flow.zoomIn({ duration: 150 })}
          />
          <ToolbarButton
            label={labels.fitView}
            icon="maximize"
            action="fit-view"
            onClick={fitView}
          />
        </span>
      </div>

      <TreeNodeContext value={nodeContext}>
        <section
          aria-label={ariaLabel}
          {...slot('canvas', styles.canvas, { testId: 'tree-editor-canvas' })}
        >
          <ReactFlow<TreeFlowNode>
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            isValidConnection={(edge) => canConnect(edge.source, edge.target)}
            onBeforeDelete={handleBeforeDelete}
            onDelete={handleDelete}
            onNodeDoubleClick={(_, node) =>
              onNodeDoubleClick?.(node.data.source as TreeEditorNode<TData>)
            }
            nodesDraggable={draggable}
            nodesConnectable={editable}
            elementsSelectable
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
