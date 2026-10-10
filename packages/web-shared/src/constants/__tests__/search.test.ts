import { describe, expect, it } from 'vitest';
import { z } from 'zod/mini';

import { keywordSearchSchema, paginationSearchShape } from '../search';

const schema = z.object({ ...paginationSearchShape(20, 100), keyword: keywordSearchSchema });

describe('列表頁網址的共用欄位', () => {
  it.each([
    [{}, { offset: 0, limit: 20, keyword: undefined }],
    [
      { offset: '40', limit: '50', keyword: '  al ' },
      { offset: 40, limit: 50, keyword: 'al' },
    ],
    [
      { offset: '-1', limit: '500' },
      { offset: 0, limit: 20, keyword: undefined },
    ],
    [
      { offset: 'x', limit: '1.5' },
      { offset: 0, limit: 20, keyword: undefined },
    ],
  ])('%j → %j', (input, expected) => {
    expect(schema.parse(input)).toEqual(expected);
  });
});
