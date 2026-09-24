import { beforeEach, describe, expect, it } from 'vitest';

import { resolveColumnSettings, useTableColumnSettingsStore } from '../tableColumnSettings';

const STORAGE_KEY = 'game-editor:table-column-settings:tables';

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
      ['c'],
      { order: ['b', 'a', 'c'], hidden: ['a'] },
    ],
    [
      '重複的 id 只留第一個',
      { order: ['a', 'a', 'b', 'c'], hidden: [] },
      [],
      { order: ['a', 'b', 'c'], hidden: [] },
    ],
  ])('%s', (_, stored, defaultHidden, expected) => {
    expect(resolveColumnSettings(['a', 'b', 'c'], stored, defaultHidden)).toEqual(expected);
  });
});

describe('useTableColumnSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useTableColumnSettingsStore.setState({ settings: {} });
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
