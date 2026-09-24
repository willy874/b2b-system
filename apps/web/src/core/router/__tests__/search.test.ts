import { describe, expect, it } from 'vitest';

import { parseSearch, stringifySearch } from '../search';

describe('網址 search 的格式（重複 key＝陣列）', () => {
  it('parseSearch：單一值是字串，重複的 key 依出現順序成為陣列', () => {
    expect(parseSearch('?keyword=a&sort=name&sort=-createdAt&offset=20')).toEqual({
      keyword: 'a',
      sort: ['name', '-createdAt'],
      offset: '20',
    });
  });

  it('parseSearch：沒有參數時是空物件', () => {
    expect(parseSearch('')).toEqual({});
  });

  it('stringifySearch：SortEntry 轉成 token，陣列展開成重複的 key，undefined 略過', () => {
    expect(
      stringifySearch({
        keyword: 'a b',
        status: undefined,
        offset: 20,
        sort: [
          { sort: 'name', order: 'asc' },
          { sort: 'createdAt', order: 'desc' },
        ],
      }),
    ).toBe('?keyword=a+b&offset=20&sort=name&sort=-createdAt');
  });

  it('stringifySearch：全部略過時是空字串（不留下孤單的 ?）', () => {
    expect(stringifySearch({ keyword: undefined })).toBe('');
  });
});
