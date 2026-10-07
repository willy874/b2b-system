import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_COMPONENT_LABELS } from '../labels';
import { toFlowEdges, toFlowNodes } from './treeEditorFlow';
import type { FlowEdgeOptions, FlowNodeOptions } from './treeEditorFlow';
import { treeEditorToolbarItems } from './treeEditorToolbar';
import type { TreeEditorToolbarOptions } from './treeEditorToolbar';
import type { TreeEditorValue } from './treeGraph';

const VALUE: TreeEditorValue<null> = {
  nodes: [
    { id: 'a', data: null, position: { x: 0, y: 0 } },
    { id: 'b', data: null, position: { x: 0, y: 100 } },
  ],
  edges: [{ source: 'a', target: 'b', variant: 'dashed' }],
};

const NODE_OPTIONS: FlowNodeOptions = {
  dragPositions: new Map(),
  nodeSize: { width: 180, height: 56 },
  selectedNodeIds: new Set(['a']),
  selectable: true,
  draggable: true,
  editable: true,
  groups: undefined,
};

const EDGE_OPTIONS: FlowEdgeOptions = {
  edgeType: 'bezier',
  selectedEdgeIds: new Set(),
  selectable: true,
  editable: true,
  activeEdgeIds: new Set(),
  highlightedEdgeIds: new Set(),
};

describe('toFlowNodes（畫面上的值 → React Flow 的節點）', () => {
  it('拖曳中的座標優先；選取只在可選取時生效', () => {
    const nodes = toFlowNodes(VALUE, {
      ...NODE_OPTIONS,
      dragPositions: new Map([['b', { x: 40, y: 120 }]]),
    });
    expect(nodes.map((node) => node.position)).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 120 },
    ]);
    expect(nodes[0]).toMatchObject({ selected: true, width: 180, height: 56, deletable: true });
    expect(toFlowNodes(VALUE, { ...NODE_OPTIONS, selectable: false })[0]?.selected).toBe(false);
  });

  it('分組背景排在最前面、在連線底下，不可選取與拖曳', () => {
    const nodes = toFlowNodes(VALUE, {
      ...NODE_OPTIONS,
      groups: [{ id: 'g', label: '分組', nodeIds: ['a', 'b'] }],
    });
    expect(nodes[0]).toMatchObject({ id: 'g', type: 'group', zIndex: -1, selectable: false });
    expect(nodes.slice(1).map((node) => node.id)).toEqual(['a', 'b']);
  });
});

describe('toFlowEdges（畫面上的值 → React Flow 的連線）', () => {
  it('連線樣式對應 React Flow 的類型，虛線與狀態以 class 表達', () => {
    const [edge] = toFlowEdges(VALUE, { ...EDGE_OPTIONS, selectedEdgeIds: new Set(['a->b']) });
    expect(edge).toMatchObject({ source: 'a', target: 'b', type: 'default', deletable: true });
    expect(edge?.className).toBeTruthy();
  });
});

const TOOLBAR_OPTIONS: TreeEditorToolbarOptions = {
  labels: DEFAULT_COMPONENT_LABELS.treeEditor,
  editable: true,
  canCreate: true,
  layout: 'manual',
  selectedIds: [],
  hasSelection: false,
  isEmpty: false,
  canUndo: false,
  canRedo: false,
  onAddRoot: vi.fn(),
  onAddChild: vi.fn(),
  onDelete: vi.fn(),
  onAutoLayout: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onZoomOut: vi.fn(),
  onZoomIn: vi.fn(),
  onFitView: vi.fn(),
};

const keys = (options: Partial<TreeEditorToolbarOptions>) =>
  treeEditorToolbarItems({ ...TOOLBAR_OPTIONS, ...options }).map((item) => item.key);

describe('treeEditorToolbarItems（工具列）', () => {
  it('可編輯、可新增、手動排版：全部按鈕', () => {
    expect(keys({})).toEqual([
      'add-root',
      'add-child',
      'delete',
      'auto-layout',
      'undo',
      'redo',
      'zoom-out',
      'zoom-in',
      'fit-view',
    ]);
  });

  it('唯讀只有檢視操作；沒有 createNode 不能新增；自動排版時沒有「自動排版」', () => {
    expect(keys({ editable: false })).toEqual(['zoom-out', 'zoom-in', 'fit-view']);
    expect(keys({ canCreate: false })).not.toContain('add-root');
    expect(keys({ layout: 'auto' })).not.toContain('auto-layout');
  });

  it('新增子節點要剛好選一個節點，加在它底下', () => {
    const onAddChild = vi.fn();
    const items = treeEditorToolbarItems({ ...TOOLBAR_OPTIONS, selectedIds: ['a'], onAddChild });
    const addChild = items.find((item) => item.key === 'add-child');
    expect(addChild?.disabled).toBe(false);
    addChild?.onClick?.();
    expect(onAddChild).toHaveBeenCalledWith('a');
  });
});
