import { describe, expect, it } from 'vitest';

import { searchJson } from './jsonSearch';

describe('searchJson', () => {
  const value = { Name: 'Hero', stats: { hp: 320, name: 'x' }, tags: ['name-tag', true] };

  it('依文件順序找鍵名與值，不分大小寫', () => {
    expect(searchJson(value, 'name')).toEqual([
      { path: '$["Name"]', target: 'key' },
      { path: '$["stats"]["name"]', target: 'key' },
      { path: '$["tags"][0]', target: 'value' },
    ]);
  });

  it('數字與布林以 JSON 字面比對，也找得到收合中的深層節點', () => {
    expect(searchJson(value, '32')).toEqual([{ path: '$["stats"]["hp"]', target: 'value' }]);
    expect(searchJson(value, 'TRUE')).toEqual([{ path: '$["tags"][1]', target: 'value' }]);
  });

  it('同一行的鍵名與值都符合時各算一筆；空白查詢沒有結果', () => {
    expect(searchJson({ hero: 'hero' }, 'her')).toHaveLength(2);
    expect(searchJson(value, '  ')).toEqual([]);
  });
});
