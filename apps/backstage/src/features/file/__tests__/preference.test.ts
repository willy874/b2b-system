import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_FILE_VIEW_PREFERENCE,
  parseFileViewPreference,
  syncFileViewPreference,
  useFileViewPreferenceStore,
} from '../preference';

describe('parseFileViewPreference（localStorage 與其他分頁的值不可信任）', () => {
  it('合法的值原樣保留', () => {
    const value = {
      viewMode: 'list',
      pagingMode: 'pagination',
      sort: { sort: 'size', order: 'asc' },
      pageSize: 120,
    };
    expect(parseFileViewPreference(value)).toEqual(value);
  });

  it('逐欄退回預設值：一個欄位壞掉不影響其他欄位', () => {
    expect(
      parseFileViewPreference({
        viewMode: 'list',
        pagingMode: 'carousel',
        sort: { sort: 'password', order: 'asc' },
        pageSize: 7,
      }),
    ).toEqual({ ...DEFAULT_FILE_VIEW_PREFERENCE, viewMode: 'list' });
    expect(parseFileViewPreference(null)).toEqual(DEFAULT_FILE_VIEW_PREFERENCE);
  });
});

const state = () => useFileViewPreferenceStore.getState();

describe('useFileViewPreferenceStore 的 sort 參考（docs/architecture/frontend/12-file-manager.md §4）', () => {
  beforeEach(() => {
    localStorage.clear();
    useFileViewPreferenceStore.setState({ ...DEFAULT_FILE_VIEW_PREFERENCE });
  });

  it('只改排列方式：sort 是同一個物件（依賴它的選取不會被清空）', () => {
    const before = state().sort;
    state().update({ viewMode: 'list' });
    expect(state().viewMode).toBe('list');
    expect(state().sort).toBe(before);
  });

  it('改了排序：換成新的值', () => {
    const before = state().sort;
    state().update({ sort: { sort: 'name', order: 'asc' } });
    expect(state().sort).not.toBe(before);
    expect(state().sort).toEqual({ sort: 'name', order: 'asc' });
  });

  it('重讀儲存的值（其他分頁改了每頁筆數）：排序沒變也沿用原本的物件', () => {
    const before = state().sort;
    state().update({ pageSize: 120 });
    const stop = syncFileViewPreference();
    expect(state().pageSize).toBe(120);
    expect(state().sort).toBe(before);
    stop();
  });
});
