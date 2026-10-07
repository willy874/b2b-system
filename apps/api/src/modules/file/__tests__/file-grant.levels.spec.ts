import { describe, expect, it } from 'vitest';

import { assignableLevels, inheritanceChain, maxLevel, missingActions } from '../file-grant.levels';
import type { HierarchyNode, LevelActions } from '../file-grant.levels';

/** 假的動作：helpers 只看「等級 → 動作」的對照，不依賴檔案的動作（docs/architecture/iam/06-resource-grants.md §6.1）。 */
type Action = 'view' | 'edit' | 'publish';
const ORDER: readonly Action[] = ['view', 'edit', 'publish'];
const LEVELS: LevelActions<Action> = {
  viewer: ['view'],
  contributor: ['view', 'edit'],
  editor: ['view', 'edit'],
  manager: ['view', 'edit', 'publish'],
};
const onlyView = (action: Action) => action === 'view';
const allButPublish = (action: Action) => action !== 'publish';

/** a ─ b ─ c ─ d（一條鏈）與旁邊的 x。 */
function tree(overrides: Partial<Record<string, Partial<HierarchyNode>>> = {}): HierarchyNode[] {
  const base: HierarchyNode[] = [
    { id: 'a', parentId: null, inheritGrants: true },
    { id: 'b', parentId: 'a', inheritGrants: true },
    { id: 'c', parentId: 'b', inheritGrants: true },
    { id: 'd', parentId: 'c', inheritGrants: true },
    { id: 'x', parentId: null, inheritGrants: true },
  ];
  return base.map((node) => ({ ...node, ...overrides[node.id] }));
}

describe('file-grant.levels 的反提權比對（docs/architecture/iam/06-resource-grants.md §6.1）', () => {
  it('missingActions 依給定順序列出缺少的動作', () => {
    expect(missingActions(LEVELS, ['manager', 'viewer'], ORDER, onlyView)).toEqual([
      'edit',
      'publish',
    ]);
  });

  it('assignableLevels：只有能力涵蓋的等級', () => {
    expect(assignableLevels(LEVELS, ORDER, allButPublish)).toEqual([
      'viewer',
      'contributor',
      'editor',
    ]);
  });
});

describe('inheritanceChain（docs/architecture/iam/06-resource-grants.md §3.3）', () => {
  it('從自己走到第一個中斷繼承的節點（含）或最上層', () => {
    const nodes = new Map(tree({ b: { inheritGrants: false } }).map((node) => [node.id, node]));
    expect(inheritanceChain(nodes, 'd')).toEqual(['d', 'c', 'b']);
    expect(inheritanceChain(nodes, 'x')).toEqual(['x']);
    expect(inheritanceChain(nodes, 'nope')).toEqual([]);
  });

  it('資料壞掉形成循環也不會無窮迴圈', () => {
    const nodes = new Map<string, HierarchyNode>([
      ['p', { id: 'p', parentId: 'q', inheritGrants: true }],
      ['q', { id: 'q', parentId: 'p', inheritGrants: true }],
    ]);
    expect(inheritanceChain(nodes, 'p')).toEqual(['p', 'q']);
  });
});

describe('maxLevel', () => {
  it('null 是「無」；其餘依全序取高', () => {
    expect(maxLevel(null, 'viewer')).toBe('viewer');
    expect(maxLevel('manager', 'editor')).toBe('manager');
    expect(maxLevel(null, null)).toBeNull();
  });
});
