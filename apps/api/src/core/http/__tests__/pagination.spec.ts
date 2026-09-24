import { describe, expect, it } from 'vitest';

import { SortSchema } from '../pagination';

const schema = SortSchema(['createdAt', 'name', 'slug']);

describe('SortSchema（多欄排序，docs/architecture/backend/03-api-conventions.md §2.1）', () => {
  it('沒帶 sort 時預設第一個欄位降冪', () => {
    expect(schema.parse({}).sort).toEqual([{ sort: 'createdAt', order: 'desc' }]);
  });

  it('單一值（express 的非重複 key）解析成一個條件；沒有 `-` 是升冪', () => {
    expect(schema.parse({ sort: 'name' }).sort).toEqual([{ sort: 'name', order: 'asc' }]);
  });

  it('欄位名前面的 `-` 是降冪', () => {
    expect(schema.parse({ sort: '-name' }).sort).toEqual([{ sort: 'name', order: 'desc' }]);
  });

  it('重複的 key 依出現順序成為排序優先順序', () => {
    expect(schema.parse({ sort: ['-slug', 'name'] }).sort).toEqual([
      { sort: 'slug', order: 'desc' },
      { sort: 'name', order: 'asc' },
    ]);
  });

  it.each([
    ['白名單以外的欄位', 'password'],
    ['舊格式 <欄位>:<方向>', 'name:asc'],
    ['兩個 `-`', '--name'],
    ['只有 `-`', '-'],
    ['同一欄位出現兩次（即使方向不同）', ['name', '-name']],
    ['空陣列', []],
  ])('%s → 驗證失敗', (_, sort) => {
    expect(schema.safeParse({ sort }).success).toBe(false);
  });
});
