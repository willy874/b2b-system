import { describe, expect, it, vi } from 'vitest';

import { GALLERY_INFINITE_MAX_PAGES, getGalleryItemsInfiniteQueryOptions } from '../query';

const { fetchItems } = vi.hoisted(() => ({ fetchItems: vi.fn() }));
vi.mock('../fetcher', () => ({ fetchGalleryItemsQuery: fetchItems }));

const page = (nextCursor: string | null, prevCursor: string | null) => ({
  items: [],
  nextCursor,
  prevCursor,
});

describe('getGalleryItemsInfiniteQueryOptions（圖片庫的無限捲動）', () => {
  const options = getGalleryItemsInfiniteQueryOptions({}, { startAt: '2026-03-01T00:00:00Z' });

  it('只保留最近的幾頁', () => {
    expect(options.maxPages).toBe(GALLERY_INFINITE_MAX_PAGES);
  });

  it('下一頁：帶 nextCursor、頁碼加一；沒有下一頁時 undefined', () => {
    const next = options.getNextPageParam;
    expect(next(page('n1', null), [], { cursor: undefined, index: 0 }, [])).toEqual({
      cursor: 'n1',
      index: 1,
    });
    expect(next(page(null, null), [], { cursor: 'x', index: 3 }, [])).toBeUndefined();
  });

  it('上一頁：只往回取被丟掉的頁（頁碼 > 0），帶 prevCursor', () => {
    const previous = options.getPreviousPageParam!;
    expect(previous(page('n', 'p4'), [], { cursor: 'c', index: 5 }, [])).toEqual({
      cursor: 'p4',
      index: 4,
    });
    // 第 0 頁（日期捲軸跳過去的起點）之前不往回取
    expect(previous(page('n', 'p'), [], { cursor: undefined, index: 0 }, [])).toBeUndefined();
    expect(previous(page('n', null), [], { cursor: 'c', index: 2 }, [])).toBeUndefined();
  });

  it('第一頁帶日期捲軸的起點；帶游標的頁不帶', async () => {
    fetchItems.mockResolvedValue(page(null, null));
    const queryFn = options.queryFn as (context: unknown) => Promise<unknown>;
    const signal = new AbortController().signal;
    await queryFn({ pageParam: { cursor: undefined, index: 0 }, signal });
    await queryFn({ pageParam: { cursor: 'c1', index: 1 }, signal });
    expect(fetchItems.mock.calls[0]![0].params).toMatchObject({
      startAt: '2026-03-01T00:00:00Z',
      cursor: undefined,
    });
    expect(fetchItems.mock.calls[1]![0].params).toMatchObject({ startAt: undefined, cursor: 'c1' });
  });
});
