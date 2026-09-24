import { describe, expect, it } from 'vitest';

import { sortSearchSchema, toSortParams } from '../sort';

describe('toSortParams（送到後端的 sort=<欄位>:<方向>）', () => {
  it('依陣列順序轉成查詢參數', () => {
    expect(
      toSortParams([
        { sort: 'name', order: 'asc' },
        { sort: 'createdAt', order: 'desc' },
      ]),
    ).toEqual(['name:asc', 'createdAt:desc']);
  });
});

describe('sortSearchSchema（網址上的排序狀態）', () => {
  const fallback = [{ sort: 'createdAt' as const, order: 'desc' as const }];
  const schema = sortSearchSchema(['createdAt', 'name'], fallback);

  it('合法的多欄排序原樣保留', () => {
    const sort = [
      { sort: 'name', order: 'asc' },
      { sort: 'createdAt', order: 'desc' },
    ];
    expect(schema.parse(sort)).toEqual(sort);
  });

  it.each([
    ['沒有帶', undefined],
    ['空陣列', []],
    ['白名單以外的欄位', [{ sort: 'password', order: 'asc' }]],
    ['不合法的方向', [{ sort: 'name', order: 'up' }]],
    [
      '同一欄位兩次',
      [
        { sort: 'name', order: 'asc' },
        { sort: 'name', order: 'desc' },
      ],
    ],
  ])('%s → 退回預設排序，不變成錯誤頁', (_, value) => {
    expect(schema.parse(value)).toEqual(fallback);
  });
});
