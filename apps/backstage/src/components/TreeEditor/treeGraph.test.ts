import { describe, expect, it } from 'vitest';

import { computeTreeLayout, placeChild, placeRoot } from './layout';
import {
  addNode,
  checkConnection,
  connectNodes,
  getDescendantIds,
  getEdgeId,
  getParentIds,
  getRootIds,
  moveNodes,
  removeElements,
  updateNodeData,
} from './treeGraph';
import type { TreeEditorValue } from './treeGraph';

const node = (id: string, position?: { x: number; y: number }) => ({ id, data: id, position });

// root ─┬─ a ── a1
//       └─ b
const tree: TreeEditorValue<string> = {
  nodes: [node('root'), node('a'), node('a1'), node('b')],
  edges: [
    { source: 'root', target: 'a' },
    { source: 'a', target: 'a1' },
    { source: 'root', target: 'b' },
  ],
};

describe('checkConnection', () => {
  it('擋下自己連自己、不存在的節點與重複的連線', () => {
    expect(checkConnection(tree, 'a', 'a', 'tree')).toBe('self');
    expect(checkConnection(tree, 'a', 'x', 'tree')).toBe('missing');
    expect(checkConnection(tree, 'root', 'a', 'dag')).toBe('duplicate');
  });

  it('擋下會形成循環的連線（子孫不能變成祖先的父節點）', () => {
    expect(checkConnection(tree, 'a1', 'root', 'tree')).toBe('cycle');
    expect(checkConnection(tree, 'a1', 'root', 'dag')).toBe('cycle');
  });

  it('tree 模式下連到已有父節點的節點是合法的（換父節點）', () => {
    expect(checkConnection(tree, 'b', 'a1', 'tree')).toBe('ok');
  });

  it('tree 模式換父節點時，先拿掉原本的父連線再判斷循環', () => {
    // a 原本在 root 底下；改接到 b 底下不會形成循環
    expect(checkConnection(tree, 'b', 'a', 'tree')).toBe('ok');
    // 但 a 不能接到自己的子孫 a1 底下
    expect(checkConnection(tree, 'a1', 'a', 'tree')).toBe('cycle');
  });
});

describe('connectNodes', () => {
  it('tree 模式取代目標原本的父連線', () => {
    const next = connectNodes(tree, 'b', 'a1', 'tree');
    expect(getParentIds(next, 'a1')).toEqual(['b']);
    expect(next.edges).toHaveLength(3);
  });

  it('dag 模式保留原本的父連線，形成多個前置', () => {
    const next = connectNodes(tree, 'b', 'a1', 'dag');
    expect(getParentIds(next, 'a1').toSorted()).toEqual(['a', 'b']);
  });

  it('不合法時回傳原本的參考', () => {
    expect(connectNodes(tree, 'a1', 'root', 'dag')).toBe(tree);
  });
});

describe('addNode / removeElements / moveNodes / updateNodeData', () => {
  it('新增子節點時一併連上父節點', () => {
    const next = addNode(tree, node('b1'), 'b');
    expect(next.nodes.map((item) => item.id)).toContain('b1');
    expect(getParentIds(next, 'b1')).toEqual(['b']);
  });

  it('刪除節點時移除它身上的連線，子節點變成根節點', () => {
    const next = removeElements(tree, ['a']);
    expect(next.nodes.map((item) => item.id)).toEqual(['root', 'a1', 'b']);
    expect(getRootIds(next)).toEqual(['root', 'a1']);
  });

  it('以 getEdgeId 刪除單一連線', () => {
    const next = removeElements(tree, [], [getEdgeId({ source: 'root', target: 'b' })]);
    expect(getRootIds(next)).toEqual(['root', 'b']);
  });

  it('只更新有給座標的節點，沒有變化時回傳原本的參考', () => {
    const next = moveNodes(tree, new Map([['a', { x: 1, y: 2 }]]));
    expect(next.nodes.find((item) => item.id === 'a')?.position).toEqual({ x: 1, y: 2 });
    expect(next.nodes.find((item) => item.id === 'b')).toBe(tree.nodes[3]);
    expect(moveNodes(tree, new Map())).toBe(tree);
  });

  it('updateNodeData 只換掉指定節點的 data', () => {
    const next = updateNodeData(tree, 'b', (data) => `${data}!`);
    expect(next.nodes.find((item) => item.id === 'b')?.data).toBe('b!');
    expect(next.nodes[0]).toBe(tree.nodes[0]);
  });
});

describe('getDescendantIds', () => {
  it('依廣度優先列出所有子孫，不含自己', () => {
    expect(getDescendantIds(tree, 'root')).toEqual(['a', 'b', 'a1']);
    expect(getDescendantIds(tree, 'a1')).toEqual([]);
  });

  it('dag 的共同子孫只列一次', () => {
    const dag = connectNodes(tree, 'b', 'a1', 'dag');
    expect(getDescendantIds(dag, 'root')).toEqual(['a', 'b', 'a1']);
  });
});

describe('排版', () => {
  const options = { direction: 'TB', nodeSize: { width: 100, height: 40 } } as const;

  it('TB：子節點在父節點下方，同一層的節點不重疊', () => {
    const positions = computeTreeLayout(tree, options);
    const y = (id: string) => positions.get(id)?.y ?? Number.NaN;
    expect(y('a')).toBeGreaterThan(y('root'));
    expect(y('a1')).toBeGreaterThan(y('a'));
    expect(y('a')).toBe(y('b'));
    const gap = Math.abs((positions.get('a')?.x ?? 0) - (positions.get('b')?.x ?? 0));
    expect(gap).toBeGreaterThanOrEqual(100);
  });

  it('BT：子節點在父節點上方', () => {
    const positions = computeTreeLayout(tree, { ...options, direction: 'BT' });
    expect(positions.get('a')?.y).toBeLessThan(positions.get('root')?.y ?? 0);
  });

  it('placeChild 放在父節點的下一層；有子節點時接在最外側那個旁邊', () => {
    const placed = {
      nodes: [
        node('root', { x: 0, y: 0 }),
        node('a', { x: -70, y: 112 }),
        node('b', { x: 70, y: 112 }),
      ],
      edges: [
        { source: 'root', target: 'a' },
        { source: 'root', target: 'b' },
      ],
    };
    expect(placeChild(placed, 'root', options)).toEqual({ x: 70 + 100 + 40, y: 40 + 72 });
    // 沒有子節點：對齊父節點
    expect(placeChild(placed, 'a', options)).toEqual({ x: -70, y: 112 + 40 + 72 });
    // RL：往左一層，橫向（y）接在兄弟之後
    expect(placeChild(placed, 'root', { ...options, direction: 'RL' })).toEqual({
      x: -(100 + 72),
      y: 112 + 40 + 40,
    });
    expect(placeChild(tree, 'root', options)).toBeUndefined();
  });

  it('placeRoot 接在既有節點的最外側；沒有節點時在原點', () => {
    expect(placeRoot({ nodes: [], edges: [] }, options)).toEqual({ x: 0, y: 0 });
    const placed = { nodes: [node('a', { x: 10, y: 5 }), node('b', { x: 300, y: 80 })], edges: [] };
    expect(placeRoot(placed, options)).toEqual({ x: 300 + 100 + 40, y: 5 });
  });
});
