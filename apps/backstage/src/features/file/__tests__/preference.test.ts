import { describe, expect, it } from 'vitest';

import { DEFAULT_FILE_VIEW_PREFERENCE, parseFileViewPreference } from '../preference';

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
