import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { files } from '@/db/schema';

import { anyUuid } from '../any-uuid';

const dialect = new PgDialect();
const render = (ids: readonly string[]) => dialect.sqlToQuery(anyUuid(files.folderId, ids));

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

describe('anyUuid（docs/architecture/backend/09-file.md §11：範圍以陣列參數傳遞）', () => {
  it('不論幾個 id 都只有一個參數：陣列字面量轉成 uuid[]', () => {
    const query = render([ID_A, ID_B]);
    expect(query.sql).toBe('"files"."folder_id" = ANY($1::uuid[])');
    expect(query.params).toEqual([`{"${ID_A}","${ID_B}"}`]);
  });

  it('超過 postgres.js 參數上限（65,534）的清單仍是一個參數', () => {
    const ids = Array.from({ length: 70_000 }, () => ID_A);
    expect(render(ids).params).toHaveLength(1);
  });

  it('空清單是空陣列（ANY 不命中任何列）', () => {
    expect(render([]).params).toEqual(['{}']);
  });

  it('元素加引號並跳脫：逗號、大括號、引號不會把一個值拆成多個元素', () => {
    expect(render(['a,b', 'c"}d', 'e\\f']).params).toEqual(['{"a,b","c\\"}d","e\\\\f"}']);
  });
});
