import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TreeEditor } from './TreeEditor';
import type { TreeEditorProps } from './TreeEditor';
import { getParentIds } from './treeGraph';
import type { TreeEditorNode, TreeEditorValue } from './treeGraph';

/**
 * jsdom 沒有布局：React Flow 需要 ResizeObserver、DOMMatrixReadOnly（讀縮放比例）與 SVG 的 getBBox。
 * 替身照 React Flow 官方的測試說明（reactflow.dev/learn/advanced-use/testing）。
 */
function installFlowDom() {
  vi.stubGlobal(
    'ResizeObserver',
    // 尺寸由下面的 offsetWidth / offsetHeight 提供，不需要真的通知
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'DOMMatrixReadOnly',
    class {
      m22: number;
      constructor(transform?: string) {
        const scale = transform?.match(/scale\(([\d.]+)\)/)?.[1];
        this.m22 = scale === undefined ? 1 : Number(scale);
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return Number.parseFloat(this.style.width) || 800;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return Number.parseFloat(this.style.height) || 600;
  });
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  });
}

beforeAll(installFlowDom);
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

interface Item {
  label: string;
}

const sample: TreeEditorValue<Item> = {
  nodes: [
    { id: 'root', data: { label: '根' }, position: { x: 0, y: 0 } },
    { id: 'a', data: { label: '甲' }, position: { x: -120, y: 128 } },
    { id: 'b', data: { label: '乙' }, position: { x: 120, y: 128 } },
  ],
  edges: [
    { source: 'root', target: 'a' },
    { source: 'root', target: 'b' },
  ],
};

let sequence = 0;
const createNode = (): TreeEditorNode<Item> => {
  sequence += 1;
  return { id: `new-${sequence}`, data: { label: `新 ${sequence}` } };
};

function renderEditor(props: Partial<TreeEditorProps<Item>> = {}) {
  const onChange = vi.fn<(value: TreeEditorValue<Item>) => void>();
  const onSelectionChange = vi.fn<(ids: string[]) => void>();
  render(
    <TreeEditor<Item>
      defaultValue={sample}
      getNodeLabel={(node) => node.data.label}
      createNode={createNode}
      onChange={onChange}
      onSelectionChange={onSelectionChange}
      aria-label="樹"
      data-testid="editor"
      {...props}
    />,
  );
  const lastValue = () => onChange.mock.lastCall?.[0] as TreeEditorValue<Item>;
  return { onChange, onSelectionChange, lastValue };
}

const item = (id: string) =>
  screen
    .getAllByTestId('tree-editor-item')
    .find((element) => element.getAttribute('data-value') === id) as HTMLElement;

const action = (name: string) =>
  within(screen.getByTestId('tree-editor-toolbar'))
    .getAllByTestId('tree-editor-action')
    .find((element) => element.getAttribute('data-value') === name) as HTMLElement;

describe('TreeEditor', () => {
  it('以 getNodeLabel 顯示每個節點，畫布是有名稱的 region', async () => {
    renderEditor();
    expect(await screen.findByRole('region', { name: '樹' })).toBeInTheDocument();
    expect(screen.getAllByTestId('tree-editor-item').map((element) => element.textContent)).toEqual(
      expect.arrayContaining(['根', '甲', '乙']),
    );
    expect(screen.getByTestId('editor')).toHaveAttribute('data-mode', 'tree');
  });

  it('renderNode 決定節點框內的內容', async () => {
    renderEditor({ renderNode: (node, state) => `${node.data.label}:${state.selected}` });
    expect(await screen.findByText('根:false')).toBeInTheDocument();
  });

  it('點節點上的「新增子節點」：接在該節點底下並選取新節點', async () => {
    const { lastValue, onSelectionChange } = renderEditor();
    const button = within(await waitFor(() => item('b'))).getByRole('button', {
      name: '新增子節點',
    });
    await userEvent.click(button);

    const value = lastValue();
    expect(value.nodes).toHaveLength(4);
    const added = value.nodes.at(-1) as TreeEditorNode<Item>;
    expect(getParentIds(value, added.id)).toEqual(['b']);
    // 放在父節點的下一層（TB：往下），不必重排
    expect(added.position?.y).toBeGreaterThan(128);
    expect(onSelectionChange).toHaveBeenLastCalledWith([added.id]);
  });

  it('點節點選取後，工具列的新增子節點與刪除才可用；Tab 也能新增子節點', async () => {
    const { lastValue } = renderEditor();
    expect(action('add-child')).toHaveAttribute('aria-disabled', 'true');
    expect(action('delete')).toHaveAttribute('aria-disabled', 'true');

    // userEvent 的 mousedown 沒有 view，d3-drag 會拋錯；選取只需要 click
    fireEvent.click(await waitFor(() => item('a')));
    await waitFor(() => expect(item('a')).toHaveAttribute('data-selected', 'true'));
    expect(action('add-child')).not.toHaveAttribute('aria-disabled');

    fireEvent.keyDown(item('a'), { key: 'Tab' });
    const value = lastValue();
    expect(getParentIds(value, value.nodes.at(-1)?.id ?? '')).toEqual(['a']);
  });

  it('刪除選取的節點時一併移除它的連線；onBeforeDelete 回傳 false 時取消', async () => {
    const onBeforeDelete = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { onChange, lastValue } = renderEditor({ onBeforeDelete });
    fireEvent.click(await waitFor(() => item('a')));
    await waitFor(() => expect(action('delete')).not.toHaveAttribute('aria-disabled'));

    await userEvent.click(action('delete'));
    await waitFor(() => expect(onBeforeDelete).toHaveBeenCalledTimes(1));
    expect(onBeforeDelete.mock.calls[0]?.[0]).toEqual({ nodeIds: ['a'], edgeIds: ['root->a'] });
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.click(action('delete'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastValue().nodes.map((node) => node.id)).toEqual(['root', 'b']);
    expect(lastValue().edges).toEqual([{ source: 'root', target: 'b' }]);
  });

  it('復原／重做：按鈕與 ⌘/Ctrl + Z、⌘/Ctrl + Shift + Z', async () => {
    const { lastValue } = renderEditor();
    expect(action('undo')).toHaveAttribute('aria-disabled', 'true');

    await userEvent.click(action('add-root'));
    expect(lastValue().nodes).toHaveLength(4);

    await userEvent.click(action('undo'));
    expect(lastValue()).toBe(sample);
    expect(action('redo')).not.toHaveAttribute('aria-disabled');

    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'z', metaKey: true, shiftKey: true });
    expect(lastValue().nodes).toHaveLength(4);
    fireEvent.keyDown(screen.getByTestId('editor'), { key: 'z', ctrlKey: true });
    expect(lastValue()).toBe(sample);
  });

  it('自動排版：每個節點換成分層排版的座標', async () => {
    const { lastValue } = renderEditor();
    await userEvent.click(action('auto-layout'));
    const positions = new Map(lastValue().nodes.map((node) => [node.id, node.position]));
    expect(positions.get('a')?.y).toBe(positions.get('b')?.y);
    expect(positions.get('a')?.y).toBeGreaterThan(positions.get('root')?.y ?? 0);
  });

  it('layout="auto" 不出現自動排版按鈕，節點沒有座標也能顯示', async () => {
    renderEditor({
      layout: 'auto',
      defaultValue: {
        nodes: sample.nodes.map(({ id, data }) => ({ id, data })),
        edges: sample.edges,
      },
    });
    expect(await screen.findAllByTestId('tree-editor-item')).toHaveLength(3);
    expect(action('auto-layout')).toBeUndefined();
  });

  it('沒有節點時顯示空狀態，可以直接新增根節點', async () => {
    const { lastValue } = renderEditor({ defaultValue: { nodes: [], edges: [] } });
    const empty = await screen.findByTestId('tree-editor-empty');
    await userEvent.click(within(empty).getByRole('button', { name: '新增根節點' }));
    expect(lastValue().nodes).toHaveLength(1);
    expect(lastValue().nodes[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('readOnly：沒有編輯用的按鈕，只剩縮放與顯示全部', async () => {
    renderEditor({ readOnly: true });
    await screen.findAllByTestId('tree-editor-item');
    const actions = within(screen.getByTestId('tree-editor-toolbar'))
      .getAllByTestId('tree-editor-action')
      .map((element) => element.getAttribute('data-value'));
    expect(actions).toEqual(['zoom-out', 'zoom-in', 'fit-view']);
    expect(screen.queryByRole('button', { name: '新增子節點' })).not.toBeInTheDocument();
    expect(screen.getByTestId('editor')).toHaveAttribute('data-readonly', 'true');
  });

  it('沒給 createNode 時不出現新增', async () => {
    renderEditor({ createNode: undefined });
    await screen.findAllByTestId('tree-editor-item');
    expect(action('add-root')).toBeUndefined();
    expect(screen.queryByTestId('tree-editor-add-child')).not.toBeInTheDocument();
  });

  it('labels 取代預設文案；testIds 取代內層的 data-testid', async () => {
    renderEditor({ labels: { addRoot: 'Add root' }, testIds: { toolbar: 'custom-toolbar' } });
    expect(await screen.findByTestId('custom-toolbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add root' })).toBeInTheDocument();
  });
});
