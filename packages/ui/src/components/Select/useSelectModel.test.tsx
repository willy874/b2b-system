import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { SelectOption } from './selectModel';
import type { SelectProps } from './selectProps';
import { useSelectActions } from './useSelectActions';
import { useSelectModel } from './useSelectModel';

const tree: SelectOption[] = [
  {
    value: 'fruit',
    label: '水果',
    children: [
      { value: 'apple', label: 'Apple' },
      { value: 'banana', label: 'Banana' },
      { value: 'cherry', label: 'Cherry', disabled: true },
    ],
  },
  { value: 'empty', label: '空群組', children: [{ value: 'x', label: 'X', disabled: true }] },
  { value: 'tea', label: 'Tea' },
];

function renderModel(props: SelectProps) {
  return renderHook((current: SelectProps) => useSelectModel(current), { initialProps: props });
}

function rowOf(result: { current: ReturnType<typeof useSelectModel> }, key: string) {
  const row = result.current.rows.find((candidate) => candidate.key === key);
  if (!row) throw new Error(`沒有 ${key} 這一列`);
  return row;
}

describe('useSelectModel（Select 的資料與狀態）', () => {
  it('多選的群組列：勾選狀態由畫面上可用的子孫決定，沒有可用子孫的群組停用', () => {
    const { result } = renderModel({
      options: tree,
      multiple: true,
      defaultValue: ['apple'],
      defaultExpandedValues: ['fruit'],
    });
    expect(result.current.isTree).toBe(true);
    expect(result.current.rowState(rowOf(result, 'fruit'))).toBe('indeterminate');
    expect(result.current.rowState(rowOf(result, 'apple'))).toBe('checked');
    expect(result.current.isRowDisabled(rowOf(result, 'cherry'))).toBe(true);
    expect(result.current.isRowDisabled(rowOf(result, 'empty'))).toBe(true);
  });

  it('單選且 selectableGroups：群組列本身是值，停用只作用在它自己', () => {
    const { result } = renderModel({
      options: [{ ...tree[0]!, disabled: true }],
      defaultValue: 'fruit',
      selectableGroups: true,
    });
    expect(result.current.rowState(rowOf(result, 'fruit'))).toBe('checked');
    expect(result.current.isRowDisabled(rowOf(result, 'fruit'))).toBe(true);
  });

  it('搜尋時有符合子孫的群組自動展開，不改動使用者的展開狀態', () => {
    const { result } = renderModel({ options: tree, searchable: true });
    expect(result.current.rows.map((row) => row.key)).toEqual(['fruit', 'empty', 'tea']);
    act(() => result.current.setSearch('ban'));
    expect(result.current.rows.map((row) => row.key)).toEqual(['fruit', 'banana']);
    expect(result.current.expanded).toEqual([]);
  });

  it('關閉時清空搜尋字（clearSearchOnClose 預設開）', () => {
    const { result } = renderModel({ options: tree, searchable: true, defaultOpen: true });
    act(() => result.current.setSearch('tea'));
    act(() => result.current.setOpen(false));
    expect(result.current.search).toBe('');
  });

  it('pinSelected：開啟當下的已選排到最前面，開啟期間勾選不重排', () => {
    const options = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ];
    const { result } = renderModel({
      options,
      multiple: true,
      pinSelected: true,
      defaultValue: ['c'],
    });
    act(() => result.current.setOpen(true));
    expect(result.current.rows.map((row) => row.key)).toEqual(['c', 'a', 'b']);
    act(() => result.current.setSelected(['c', 'b']));
    expect(result.current.rows.map((row) => row.key)).toEqual(['c', 'a', 'b']);
  });

  it("valueOrder='options'：觸發鈕上的值依選項順序", () => {
    const { result } = renderModel({
      options: tree,
      multiple: true,
      valueOrder: 'options',
      defaultValue: ['tea', 'apple'],
    });
    expect(result.current.displayValues).toEqual(['apple', 'tea']);
  });
});

function keyDown(key: string, init: Partial<KeyboardEvent<HTMLElement>> = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    // 列表本身（不是搜尋框）
    currentTarget: document.createElement('div'),
    preventDefault: vi.fn(),
    ...init,
  } as unknown as KeyboardEvent<HTMLElement>;
}

function renderActions(props: SelectProps) {
  return renderHook(() => {
    const model = useSelectModel(props);
    const actions = useSelectActions(model, {
      scrollElement: null,
      scrollToIndex: () => undefined,
      inputRef: { current: null },
    });
    return { model, actions };
  });
}

describe('useSelectActions（作用列、勾選與鍵盤）', () => {
  it('單選：pick 一列就選取並關閉', () => {
    const onValueChange = vi.fn();
    const { result } = renderActions({
      options: tree,
      defaultOpen: true,
      onValueChange,
    });
    const teaIndex = result.current.model.rows.findIndex((row) => row.key === 'tea');
    act(() => result.current.actions.pick(teaIndex));
    expect(onValueChange).toHaveBeenCalledWith('tea');
    expect(result.current.model.open).toBe(false);
  });

  it('單選的群組列：pick 是展開收合，→／← 也是', () => {
    const { result } = renderActions({ options: tree, defaultOpen: true });
    act(() => result.current.actions.pick(0));
    expect(result.current.model.expanded).toEqual(['fruit']);
    act(() => result.current.actions.onListKeyDown(keyDown('ArrowLeft')));
    expect(result.current.model.expanded).toEqual([]);
    act(() => result.current.actions.onListKeyDown(keyDown('ArrowRight')));
    expect(result.current.model.expanded).toEqual(['fruit']);
  });

  it('多選：pick 群組列切換它底下可用的子孫；Ctrl/⌘ + A 切換全選', () => {
    const onValueChange = vi.fn();
    const { result } = renderActions({
      options: tree,
      multiple: true,
      defaultOpen: true,
      onValueChange,
    });
    act(() => result.current.actions.pick(0));
    expect(onValueChange).toHaveBeenLastCalledWith(['apple', 'banana']);
    act(() => result.current.actions.onListKeyDown(keyDown('a', { ctrlKey: true })));
    expect(onValueChange).toHaveBeenLastCalledWith(['apple', 'banana', 'tea']);
  });
});
