import { act, renderHook } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { KeyboardEvent, ReactNode } from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { TreeEditorLayout, TreeEditorProps } from './treeEditorTypes';
import type { TreeEditorMode, TreeEditorNode, TreeEditorValue } from './treeGraph';
import { useTreeEditActions } from './useTreeEditActions';
import { useTreeHistory } from './useTreeHistory';
import { useTreeSelection } from './useTreeSelection';

// root ─┬─ a
//       └─ b
const sample: TreeEditorValue<string> = {
  nodes: [
    { id: 'root', data: 'root', position: { x: 0, y: 0 } },
    { id: 'a', data: 'a', position: { x: -70, y: 112 } },
    { id: 'b', data: 'b', position: { x: 70, y: 112 } },
  ],
  edges: [
    { source: 'root', target: 'a' },
    { source: 'root', target: 'b' },
  ],
};

const layoutOptions = { direction: 'TB', nodeSize: { width: 100, height: 40 } } as const;

interface HarnessOptions extends Pick<
  TreeEditorProps<string>,
  'createNode' | 'isValidConnection' | 'onBeforeDelete'
> {
  initial?: TreeEditorValue<string>;
  layout?: TreeEditorLayout;
  mode?: TreeEditorMode;
  editable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
}

let sequence = 0;
const createNode = (): TreeEditorNode<string> => {
  sequence += 1;
  return { id: `new-${sequence}`, data: `new-${sequence}` };
};

/** TreeEditor 裡三個 hook 的組合方式：值 → 歷史 → 選取 → 編輯動作。 */
function renderActions({
  initial = sample,
  layout = 'manual',
  mode = 'tree',
  editable = true,
  onSelectionChange,
  ...props
}: HarnessOptions = {}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ReactFlowProvider>{children}</ReactFlowProvider>
  );
  return renderHook(
    () => {
      const [value, setValue] = useState(initial);
      const history = useTreeHistory(value, setValue);
      const selection = useTreeSelection(value.nodes, onSelectionChange);
      const actions = useTreeEditActions({
        display: value,
        history,
        selection,
        layout,
        layoutOptions,
        mode,
        editable,
        ...props,
      });
      return { value, setValue, history, selection, actions };
    },
    { wrapper },
  );
}

function keyEvent(init: Partial<KeyboardEvent<HTMLDivElement>>) {
  return {
    key: '',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    target: document.createElement('div'),
    preventDefault: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent<HTMLDivElement>;
}

const positionOf = (value: TreeEditorValue<string>, id: string) =>
  value.nodes.find((node) => node.id === id)?.position;

describe('useTreeEditActions（TreeEditor 的編輯動作）', () => {
  describe('拖曳', () => {
    it('拖曳中只更新暫存的座標；放開才寫入一步', () => {
      const { result } = renderActions();

      act(() =>
        result.current.actions.handleNodesChange([
          { type: 'position', id: 'a', position: { x: 5, y: 6 }, dragging: true },
        ]),
      );
      expect(result.current.actions.dragPositions.get('a')).toEqual({ x: 5, y: 6 });
      expect(result.current.value).toBe(sample);

      act(() =>
        result.current.actions.handleNodesChange([
          { type: 'position', id: 'a', position: { x: 7, y: 8 }, dragging: false },
        ]),
      );
      expect(positionOf(result.current.value, 'a')).toEqual({ x: 7, y: 8 });
      expect(result.current.actions.dragPositions.size).toBe(0);
      expect(result.current.history.canUndo).toBe(true);
    });

    it('沒有座標變更（只有選取）時不寫入', () => {
      const { result } = renderActions();

      act(() =>
        result.current.actions.handleNodesChange([{ type: 'select', id: 'a', selected: true }]),
      );

      expect(result.current.value).toBe(sample);
      expect(result.current.selection.selectedIds).toEqual(['a']);
    });
  });

  describe('連線', () => {
    it('tree 模式：連到已有父節點的節點時取代原本的父連線', () => {
      const { result } = renderActions();

      act(() =>
        result.current.actions.handleConnect({
          source: 'a',
          target: 'b',
          sourceHandle: null,
          targetHandle: null,
        }),
      );

      expect(result.current.value.edges).toEqual([
        { source: 'root', target: 'a' },
        { source: 'a', target: 'b' },
      ]);
    });

    it('會形成循環的連線不寫入', () => {
      const { result } = renderActions();

      expect(result.current.actions.canConnect('a', 'root')).toBe(false);
      act(() =>
        result.current.actions.handleConnect({
          source: 'a',
          target: 'root',
          sourceHandle: null,
          targetHandle: null,
        }),
      );

      expect(result.current.value).toBe(sample);
    });

    it('isValidConnection 回傳 false 時不能連', () => {
      const isValidConnection = vi.fn(() => false);
      const { result } = renderActions({ isValidConnection, mode: 'dag' });

      expect(result.current.actions.canConnect('a', 'b')).toBe(false);
      expect(isValidConnection).toHaveBeenCalledWith({ source: 'a', target: 'b' }, sample);
    });
  });

  describe('刪除', () => {
    it('唯讀時一律不刪；沒有 onBeforeDelete 時直接刪', async () => {
      const request = { nodes: [], edges: [] };
      const readonly = renderActions({ editable: false });
      await expect(readonly.result.current.actions.handleBeforeDelete(request)).resolves.toBe(
        false,
      );

      const editable = renderActions();
      await expect(editable.result.current.actions.handleBeforeDelete(request)).resolves.toBe(true);
    });

    it('onBeforeDelete 收到要刪的節點與連線 id，以它的回傳值決定', async () => {
      const onBeforeDelete = vi.fn(async () => false);
      const { result } = renderActions({ onBeforeDelete });

      const allowed = await result.current.actions.handleBeforeDelete({
        nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: {} }] as never,
        edges: [{ id: 'root->a', source: 'root', target: 'a' }],
      });

      expect(allowed).toBe(false);
      expect(onBeforeDelete).toHaveBeenCalledWith({ nodeIds: ['a'], edgeIds: ['root->a'] });
    });

    it('handleDelete 一步刪掉節點與相連的連線，並清掉連線的選取', () => {
      const { result } = renderActions();
      act(() =>
        result.current.selection.applyEdgeChanges([
          { type: 'select', id: 'root->b', selected: true },
        ]),
      );

      act(() =>
        result.current.actions.handleDelete({
          nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: {} }] as never,
          edges: [],
        }),
      );

      expect(result.current.value.nodes.map((node) => node.id)).toEqual(['root', 'b']);
      expect(result.current.value.edges).toEqual([{ source: 'root', target: 'b' }]);
      expect(result.current.selection.selectedEdgeIds.size).toBe(0);
    });
  });

  describe('新增', () => {
    it('manual：新根節點接在既有節點的最外側，並只選取它', () => {
      const { result } = renderActions({ createNode });

      act(() => result.current.actions.addRoot());

      const added = result.current.value.nodes.at(-1)!;
      expect(added.position).toEqual({ x: 70 + 100 + 40, y: 0 });
      expect(result.current.selection.selectedIds).toEqual([added.id]);
    });

    it('auto：新節點不帶座標（交給自動排版）', () => {
      const { result } = renderActions({ createNode, layout: 'auto' });

      act(() => result.current.actions.addRoot());
      act(() => result.current.actions.handleAddChild('a'));

      expect(result.current.value.nodes.slice(-2).map((node) => node.position)).toEqual([
        undefined,
        undefined,
      ]);
    });

    it('新增子節點接在父節點底下', () => {
      const { result } = renderActions({ createNode });

      act(() => result.current.actions.handleAddChild('a'));

      const added = result.current.value.nodes.at(-1)!;
      expect(result.current.value.edges.at(-1)).toEqual({ source: 'a', target: added.id });
      expect(added.position).toEqual({ x: -70, y: 112 + 40 + 72 });
    });

    it('沒有 createNode 時不新增', () => {
      const { result } = renderActions();

      act(() => result.current.actions.addRoot());
      act(() => result.current.actions.handleAddChild('a'));

      expect(result.current.value).toBe(sample);
    });
  });

  describe('自動排版', () => {
    it('整份重新排版是一步，可以復原', () => {
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0);
      const { result } = renderActions();

      act(() => result.current.actions.autoLayout());
      expect(result.current.value).not.toBe(sample);

      act(() => result.current.history.undo());
      expect(result.current.value).toBe(sample);
      vi.restoreAllMocks();
    });
  });

  describe('快捷鍵', () => {
    it('Ctrl＋Y 重做', () => {
      const { result } = renderActions({ createNode });
      act(() => result.current.actions.addRoot());
      act(() => result.current.history.undo());

      const event = keyEvent({ key: 'y', ctrlKey: true });
      act(() => result.current.actions.handleKeyDown(event));

      expect(result.current.value.nodes).toHaveLength(4);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('Tab 在唯一選取的節點底下新增子節點', () => {
      const { result } = renderActions({ createNode });
      act(() => result.current.selection.selectOnly('b'));

      act(() => result.current.actions.handleKeyDown(keyEvent({ key: 'Tab' })));

      const added = result.current.value.nodes.at(-1)!;
      expect(result.current.value.edges.at(-1)).toEqual({ source: 'b', target: added.id });
    });

    it('選取多個節點時 Tab 不新增', () => {
      const { result } = renderActions({ createNode });
      act(() =>
        result.current.actions.handleNodesChange([
          { type: 'select', id: 'a', selected: true },
          { type: 'select', id: 'b', selected: true },
        ]),
      );

      act(() => result.current.actions.handleKeyDown(keyEvent({ key: 'Tab' })));

      expect(result.current.value).toBe(sample);
    });

    it('唯讀時、或焦點在輸入框裡時，快捷鍵不作用', () => {
      const readonly = renderActions({ createNode, editable: false });
      act(() => readonly.result.current.selection.selectOnly('a'));
      act(() => readonly.result.current.actions.handleKeyDown(keyEvent({ key: 'Tab' })));
      expect(readonly.result.current.value).toBe(sample);

      const typing = renderActions({ createNode });
      act(() => typing.result.current.actions.addRoot());
      const event = keyEvent({ key: 'z', ctrlKey: true, target: document.createElement('input') });
      act(() => typing.result.current.actions.handleKeyDown(event));
      expect(typing.result.current.value.nodes).toHaveLength(4);
      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });
});

describe('useTreeHistory（整份快照的復原／重做）', () => {
  it('寫入同一個參考不算一步', () => {
    const { result } = renderActions();

    act(() => result.current.history.commit(result.current.value));

    expect(result.current.history.canUndo).toBe(false);
  });

  it('沒有紀錄時復原與重做不做事', () => {
    const { result } = renderActions();

    act(() => result.current.history.undo());
    act(() => result.current.history.redo());

    expect(result.current.value).toBe(sample);
  });

  it('呼叫端換了一份資料時清空紀錄', () => {
    const { result } = renderActions({ createNode });
    act(() => result.current.actions.addRoot());
    expect(result.current.history.canUndo).toBe(true);

    act(() => result.current.setValue({ nodes: [], edges: [] }));

    expect(result.current.history.canUndo).toBe(false);
    expect(result.current.history.canRedo).toBe(false);
  });

  it('新的一步會清掉重做的紀錄', () => {
    const { result } = renderActions({ createNode });
    act(() => result.current.actions.addRoot());
    act(() => result.current.history.undo());
    expect(result.current.history.canRedo).toBe(true);

    act(() => result.current.actions.handleAddChild('a'));

    expect(result.current.history.canRedo).toBe(false);
  });
});

describe('useTreeSelection（節點與連線的選取）', () => {
  it('連線的選取與取消', () => {
    const { result } = renderActions();

    act(() =>
      result.current.selection.applyEdgeChanges([
        { type: 'select', id: 'root->a', selected: true },
        { type: 'select', id: 'root->b', selected: true },
      ]),
    );
    act(() =>
      result.current.selection.applyEdgeChanges([
        { type: 'select', id: 'root->a', selected: false },
        { type: 'remove', id: 'root->b' },
      ]),
    );

    expect([...result.current.selection.selectedEdgeIds]).toEqual(['root->b']);
    expect(result.current.selection.hasSelection).toBe(true);
  });

  it('沒有 select 的變更不改變選取', () => {
    const { result } = renderActions();
    const before = result.current.selection.selectedEdgeIds;

    act(() => result.current.selection.applyEdgeChanges([{ type: 'remove', id: 'root->a' }]));

    expect(result.current.selection.selectedEdgeIds).toBe(before);
  });

  it('刪掉的節點從選取裡消失，並通知 onSelectionChange', () => {
    const onSelectionChange = vi.fn();
    const { result } = renderActions({ onSelectionChange });
    act(() =>
      result.current.actions.handleNodesChange([
        { type: 'select', id: 'a', selected: true },
        { type: 'select', id: 'b', selected: true },
      ]),
    );
    expect(onSelectionChange).toHaveBeenLastCalledWith(['a', 'b']);

    act(() =>
      result.current.actions.handleDelete({
        nodes: [{ id: 'a', position: { x: 0, y: 0 }, data: {} }] as never,
        edges: [],
      }),
    );

    expect(result.current.selection.selectedIds).toEqual(['b']);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['b']);
  });

  it('取消節點的選取；全部取消時通知空陣列', () => {
    const onSelectionChange = vi.fn();
    const { result } = renderActions({ onSelectionChange });
    act(() => result.current.selection.selectOnly('a'));

    act(() =>
      result.current.actions.handleNodesChange([{ type: 'select', id: 'a', selected: false }]),
    );

    expect(result.current.selection.hasSelection).toBe(false);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });
});
