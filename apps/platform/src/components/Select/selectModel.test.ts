import { describe, expect, it } from 'vitest';

import {
  checkState,
  flattenRows,
  indexOptions,
  orderByOptions,
  sortOptions,
  toggleValues,
} from './selectModel';
import type { SelectOption } from './selectModel';

const tree: SelectOption[] = [
  {
    value: 'fruit',
    label: '水果',
    children: [
      { value: 'banana', label: 'Banana' },
      { value: 'apple', label: 'Apple' },
      { value: 'cherry', label: 'Cherry', disabled: true },
    ],
  },
  { value: 'item10', label: 'Item 10' },
  { value: 'item2', label: 'Item 2' },
];

const values = (options: SelectOption[]) => options.map((option) => option.value);
const byLength = (a: SelectOption, b: SelectOption) => a.value.length - b.value.length;

describe('sortOptions', () => {
  it('沒有指定排序時回傳同一個陣列', () => {
    expect(sortOptions(tree, undefined)).toBe(tree);
  });

  it.each([
    ['asc', ['item2', 'item10', 'fruit']],
    ['desc', ['fruit', 'item10', 'item2']],
  ] as const)('%s 以自然順序排序（數字 2 在 10 前面）', (order, expected) => {
    expect(values(sortOptions(tree, order))).toEqual(expected);
  });

  it('子選項各自排序，且不改動原陣列', () => {
    const sorted = sortOptions(tree, 'asc');
    expect(values(sorted.find((option) => option.value === 'fruit')?.children ?? [])).toEqual([
      'apple',
      'banana',
      'cherry',
    ]);
    expect(values(tree)).toEqual(['fruit', 'item10', 'item2']);
  });

  it('可以傳比較函式', () => {
    expect(values(sortOptions(tree, byLength))).toEqual(['fruit', 'item2', 'item10']);
  });
});

describe('indexOptions', () => {
  it('群組的可用葉節點排除停用項目', () => {
    const index = indexOptions(tree);
    expect(index.groupLeaves.get('fruit')).toEqual(['banana', 'apple']);
    expect(index.enabledLeaves).toEqual(['banana', 'apple', 'item10', 'item2']);
    expect(index.hasGroups).toBe(true);
  });

  it('停用的群組底下全部視為停用', () => {
    const index = indexOptions([{ ...tree[0], disabled: true } as SelectOption]);
    expect(index.groupLeaves.get('fruit')).toEqual([]);
    expect(index.enabledLeaves).toEqual([]);
  });
});

describe('flattenRows', () => {
  it('只展開 expanded 裡的群組，子列記錄父列位置與層級', () => {
    expect(flattenRows(tree, new Set()).map((row) => row.key)).toEqual([
      'fruit',
      'item10',
      'item2',
    ]);
    const rows = flattenRows(tree, new Set(['fruit']));
    expect(rows.map((row) => row.key)).toEqual([
      'fruit',
      'banana',
      'apple',
      'cherry',
      'item10',
      'item2',
    ]);
    expect(rows[1]).toMatchObject({ parentIndex: 0, depth: 1 });
    expect(rows[3]).toMatchObject({ disabled: true });
  });

  it('selectAll 在最前面加一列全選', () => {
    expect(flattenRows(tree, new Set(), { selectAll: true })[0]?.kind).toBe('all');
  });

  it('pinned 依給定順序排到最前面（只在沒有群組時）', () => {
    const flat = tree.slice(1).concat({ value: 'x', label: 'X' });
    expect(flattenRows(flat, new Set(), { pinned: ['x', 'item2'] }).map((row) => row.key)).toEqual([
      'x',
      'item2',
      'item10',
    ]);
    expect(flattenRows(tree, new Set(), { pinned: ['item2'] }).map((row) => row.key)).toEqual([
      'fruit',
      'item10',
      'item2',
    ]);
  });
});

describe('選取工具', () => {
  it.each([
    [[], ['a'], 'unchecked'],
    [['a', 'b'], ['a', 'b'], 'checked'],
    [['a', 'b'], ['a'], 'indeterminate'],
  ] as const)('checkState(%j, 已選 %j) = %s', (leaves, selected, expected) => {
    expect(checkState(leaves, new Set<string>(selected))).toBe(expected);
  });

  it('toggleValues 勾選時附加在尾端（保留勾選先後），沒變化時回傳原陣列', () => {
    const current = ['c'];
    expect(toggleValues(current, ['a', 'c', 'b'], true)).toEqual(['c', 'a', 'b']);
    expect(toggleValues(current, ['c'], true)).toBe(current);
    expect(toggleValues(['a', 'b', 'c'], ['b'], false)).toEqual(['a', 'c']);
    expect(toggleValues(current, ['z'], false)).toBe(current);
  });

  it('orderByOptions 依選項順序，未知的值保留原順序放最後', () => {
    const order = new Map([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
    expect(orderByOptions(['y', 'c', 'x', 'a'], order)).toEqual(['a', 'c', 'y', 'x']);
  });
});
