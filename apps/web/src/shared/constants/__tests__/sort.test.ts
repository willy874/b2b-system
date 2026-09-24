import { describe, expect, it } from 'vitest';

import { parseSortToken, sortSearchSchema, toSortParams } from '../sort';

describe('toSortParams（送到後端的 sort=<欄位> / sort=-<欄位>）', () => {
  it('依陣列順序轉成查詢參數', () => {
    expect(
      toSortParams([
        { sort: 'name', order: 'asc' },
        { sort: 'createdAt', order: 'desc' },
      ]),
    ).toEqual(['name', '-createdAt']);
  });

  it('parseSortToken 是反向轉換', () => {
    expect(parseSortToken('name')).toEqual({ sort: 'name', order: 'asc' });
    expect(parseSortToken('-createdAt')).toEqual({ sort: 'createdAt', order: 'desc' });
  });
});

describe('sortSearchSchema（網址上的排序狀態）', () => {
  const schema = sortSearchSchema(['createdAt', 'name']);

  it('合法的多欄排序原樣保留', () => {
    const sort = [
      { sort: 'name', order: 'asc' },
      { sort: 'createdAt', order: 'desc' },
    ];
    expect(schema.parse(sort)).toEqual(sort);
  });

  it('網址上的 token（單一字串或重複 key 的陣列）解析成 SortEntry[]', () => {
    expect(schema.parse('-name')).toEqual([{ sort: 'name', order: 'desc' }]);
    expect(schema.parse(['name', '-createdAt'])).toEqual([
      { sort: 'name', order: 'asc' },
      { sort: 'createdAt', order: 'desc' },
    ]);
  });

  it.each([
    ['沒有帶', undefined],
    ['白名單以外的欄位', [{ sort: 'password', order: 'asc' }]],
    ['白名單以外的欄位（token）', 'password'],
    ['舊格式 <欄位>:<方向>', 'name:asc'],
    ['同一欄位兩次（token）', ['name', '-name']],
    ['不合法的方向', [{ sort: 'name', order: 'up' }]],
    [
      '同一欄位兩次',
      [
        { sort: 'name', order: 'asc' },
        { sort: 'name', order: 'desc' },
      ],
    ],
  ])('%s → 空陣列（後端預設排序），不變成錯誤頁', (_, value) => {
    expect(schema.parse(value)).toEqual([]);
  });
});
