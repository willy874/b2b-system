import { describe, expect, it } from 'vitest';

import { inheritanceChain, maxLevel, resolveHierarchyLevels } from '../resource-grant.resolver';
import type { HierarchyNode } from '../resource-grant.resolver';

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

describe('resolveHierarchyLevels（docs/rbac/07-resource-grants.md §3.1）', () => {
  it('授權往下繼承；旁支與上層不受影響', () => {
    const levelOf = resolveHierarchyLevels(tree(), [{ resourceId: 'b', level: 'viewer' }]);
    expect(['a', 'b', 'c', 'd', 'x'].map(levelOf)).toEqual([
      null,
      'viewer',
      'viewer',
      'viewer',
      null,
    ]);
  });

  it('同一個節點或整條鏈上有多筆時取最高者', () => {
    const levelOf = resolveHierarchyLevels(tree(), [
      { resourceId: 'a', level: 'editor' },
      { resourceId: 'c', level: 'viewer' },
      { resourceId: 'c', level: 'contributor' },
    ]);
    expect(levelOf('c')).toBe('editor');
    expect(levelOf('d')).toBe('editor');
  });

  it('中斷繼承：上層的授權到此為止，自己的直接授權仍有效並往下流', () => {
    const levelOf = resolveHierarchyLevels(tree({ c: { inheritGrants: false } }), [
      { resourceId: 'a', level: 'manager' },
      { resourceId: 'd', level: 'viewer' },
    ]);
    expect(levelOf('b')).toBe('manager');
    expect(levelOf('c')).toBeNull();
    expect(levelOf('d')).toBe('viewer');
  });

  it('不存在的節點是 null；查詢順序不影響結果（記憶化）', () => {
    const grants = [{ resourceId: 'a', level: 'contributor' as const }];
    const first = resolveHierarchyLevels(tree(), grants);
    const second = resolveHierarchyLevels(tree(), grants);
    expect([first('d'), first('b')]).toEqual([second('b'), second('d')]);
    expect(first('nope')).toBeNull();
  });

  it('資料壞掉形成循環也不會無窮迴圈', () => {
    const levelOf = resolveHierarchyLevels(
      [
        { id: 'p', parentId: 'q', inheritGrants: true },
        { id: 'q', parentId: 'p', inheritGrants: true },
      ],
      [{ resourceId: 'q', level: 'viewer' }],
    );
    expect(levelOf('p')).toBe('viewer');
  });
});

describe('inheritanceChain', () => {
  it('從自己走到第一個中斷繼承的節點（含）或最上層', () => {
    const nodes = new Map(tree({ b: { inheritGrants: false } }).map((node) => [node.id, node]));
    expect(inheritanceChain(nodes, 'd')).toEqual(['d', 'c', 'b']);
    expect(inheritanceChain(nodes, 'x')).toEqual(['x']);
    expect(inheritanceChain(nodes, 'nope')).toEqual([]);
  });
});

describe('maxLevel', () => {
  it('null 是「無」；其餘依全序取高', () => {
    expect(maxLevel(null, 'viewer')).toBe('viewer');
    expect(maxLevel('manager', 'editor')).toBe('manager');
    expect(maxLevel(null, null)).toBeNull();
  });
});
