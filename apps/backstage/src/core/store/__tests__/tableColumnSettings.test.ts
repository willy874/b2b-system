import { beforeEach, describe, expect, it } from 'vitest';

import { resolveColumnSettings, useTableColumnSettingsStore } from '../tableColumnSettings';

const STORAGE_KEY = 'b2b-system:table-column-settings:tables';

describe('resolveColumnSettings（把存下來的設定套到目前的欄位）', () => {
  it.each([
    [
      '沒有存過 → 原本順序，套用預設隱藏',
      undefined,
      ['b'],
      { order: ['a', 'b', 'c'], hidden: ['b'] },
    ],
    ['預設隱藏裡不存在的欄位會被略過', undefined, ['x'], { order: ['a', 'b', 'c'], hidden: [] }],
    [
      '照存下來的順序',
      { order: ['c', 'a', 'b'], hidden: [] },
      [],
      { order: ['c', 'a', 'b'], hidden: [] },
    ],
    [
      '已經不存在的欄位被丟掉',
      { order: ['x', 'b', 'a', 'c'], hidden: ['x'] },
      [],
      { order: ['b', 'a', 'c'], hidden: [] },
    ],
    [
      '新加的欄位接在最後並顯示',
      { order: ['b', 'a'], hidden: ['a'] },
      [],
      { order: ['b', 'a', 'c'], hidden: ['a'] },
    ],
    [
      '新加的欄位若在 defaultHidden 裡則隱藏',
      { order: ['b', 'a'], hidden: [] },
      ['c'],
      { order: ['b', 'a', 'c'], hidden: ['c'] },
    ],
    [
      '重複的 id 只留第一個',
      { order: ['a', 'a', 'b', 'c'], hidden: [] },
      [],
      { order: ['a', 'b', 'c'], hidden: [] },
    ],
  ])('%s', (_, stored, defaultHidden, expected) => {
    expect(resolveColumnSettings(['a', 'b', 'c'], stored, defaultHidden)).toEqual({
      ...expected,
      // 預設固定操作欄，但這張表沒有操作欄，所以被濾掉
      pinnedColumns: {},
      stickyHeader: false,
    });
  });

  it('工具欄的預設：勾選欄固定在 start、釘選欄隱藏；已存過設定的表新加這兩欄時也套用，並插在最前面', () => {
    const ids = ['__select', '__pin', 'a'];
    expect(resolveColumnSettings(ids, undefined, [], ['actions'])).toEqual({
      order: ids,
      hidden: ['__pin'],
      pinnedColumns: { __select: 'start', actions: 'end' },
      stickyHeader: false,
    });
    expect(
      resolveColumnSettings(ids, { order: ['a'], hidden: [], pinnedColumns: {} }, [], ['actions']),
    ).toEqual({
      order: ['__select', '__pin', 'a'],
      hidden: ['__pin'],
      pinnedColumns: { __select: 'start' },
      stickyHeader: false,
    });
  });

  it('預設把操作欄固定在 end（有 fixedColumnIds 時）', () => {
    expect(resolveColumnSettings(['a'], undefined, [], ['actions']).pinnedColumns).toEqual({
      actions: 'end',
    });
  });

  it('沿用存下來的固定設定，丟掉已經不存在的欄位', () => {
    expect(
      resolveColumnSettings(
        ['a', 'b'],
        {
          order: ['a', 'b'],
          hidden: [],
          pinnedColumns: { a: 'start', x: 'end' },
          stickyHeader: true,
        },
        [],
        ['actions'],
      ),
    ).toEqual({
      order: ['a', 'b'],
      hidden: [],
      pinnedColumns: { a: 'start' },
      stickyHeader: true,
    });
  });
});

describe('useTableColumnSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTableColumnSettingsStore.setState({ settings: {}, pinnedRows: {} });
  });

  it('寫入時存進 localStorage，各表格分開', () => {
    const { setTableSettings } = useTableColumnSettingsStore.getState();
    setTableSettings('user-list', { order: ['b', 'a'], hidden: ['a'] });
    setTableSettings('role-list', { order: ['x'], hidden: [] });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      'user-list': { order: ['b', 'a'], hidden: ['a'] },
      'role-list': { order: ['x'], hidden: [] },
    });
  });

  it('重設只移除該表格的設定', () => {
    const { setTableSettings, resetTableSettings } = useTableColumnSettingsStore.getState();
    setTableSettings('user-list', { order: ['b', 'a'], hidden: [] });
    setTableSettings('role-list', { order: ['x'], hidden: [] });
    resetTableSettings('user-list');

    expect(useTableColumnSettingsStore.getState().settings).toEqual({
      'role-list': { order: ['x'], hidden: [] },
    });
  });
});

describe('釘選的資料列', () => {
  const PINNED_KEY = 'b2b-system:table-column-settings:pinnedRows';

  beforeEach(() => {
    localStorage.clear();
    useTableColumnSettingsStore.setState({ settings: {}, pinnedRows: {} });
  });

  it('釘選寫進 localStorage；同一列改側時移到該側的最後', () => {
    const { pinRow } = useTableColumnSettingsStore.getState();
    pinRow('user-list', '1', 'top', { id: '1' });
    pinRow('user-list', '2', 'bottom', { id: '2' });
    pinRow('user-list', '1', 'bottom', { id: '1' });

    expect(JSON.parse(localStorage.getItem(PINNED_KEY) ?? '{}')).toEqual({
      'user-list': [
        { id: '2', side: 'bottom', row: { id: '2' } },
        { id: '1', side: 'bottom', row: { id: '1' } },
      ],
    });
  });

  it('取消最後一列時整張表的紀錄一起移除；重設欄位設定不影響釘選', () => {
    const { pinRow, unpinRow, setTableSettings, resetTableSettings } =
      useTableColumnSettingsStore.getState();
    pinRow('user-list', '1', 'top', {});
    setTableSettings('user-list', { order: ['a'], hidden: [] });
    resetTableSettings('user-list');
    expect(useTableColumnSettingsStore.getState().pinnedRows['user-list']).toHaveLength(1);

    unpinRow('user-list', '1');
    expect(useTableColumnSettingsStore.getState().pinnedRows).toEqual({});
  });
});
