import { describe, expect, it } from 'vitest';

import { decodeGalleryCursor, encodeGalleryCursor } from '../gallery.cursor';

const ID = '33333333-3333-4333-8333-333333333333';

function raw(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

describe('gallery 的 keyset 游標（docs/architecture/backend/26-gallery.md §6）', () => {
  it.each([
    { sort: 'sortAt', order: 'desc', value: '2026-03-14T02:20:30.123456Z', id: ID },
    { sort: 'createdAt', order: 'asc', value: '2026-03-14T02:20:30.123Z', id: ID },
    { sort: 'title', order: 'asc', value: '產品照 01', id: ID },
  ] as const)('encode 之後 decode 回同一個值（$sort）', (cursor) => {
    expect(decodeGalleryCursor(encodeGalleryCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ['不是 base64 的 JSON', 'not-json'],
    ['欄位數不對', raw(['sortAt', 'desc', ID])],
    ['不認得的排序', raw(['size', 'desc', 1, ID])],
    ['方向不對', raw(['sortAt', 'up', '2026-03-14T02:20:30.123Z', ID])],
    ['id 不是 uuid', raw(['sortAt', 'desc', '2026-03-14T02:20:30.123Z', 'x'])],
    ['時間不是 encode 的格式', raw(['sortAt', 'desc', '2026-02-30', ID])],
    ['標題含 NUL', raw(['title', 'asc', 'a\u0000', ID])],
  ])('%s → undefined', (_name, value) => {
    expect(decodeGalleryCursor(value)).toBeUndefined();
  });
});
