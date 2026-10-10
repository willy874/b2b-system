import { toSortParams } from '@b2b-system/web-shared/constants';
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import type { GalleryItemList } from '@/shared/api-sdk';

import type { GalleryItemFilters } from '../types';
import { fetchGalleryItemsQuery } from './fetcher';

export const GALLERY_ITEMS_QUERY_KEY = 'GALLERY_ITEMS_QUERY_KEY';

/** 一頁幾張（後端的預設）。 */
export const GALLERY_PAGE_SIZE = 100;

const filterKeys = (filters: GalleryItemFilters) =>
  [
    filters.keyword ?? '',
    filters.albumId ?? '',
    filters.tagId?.join(',') ?? '',
    filters.takenFrom ?? '',
    filters.takenTo ?? '',
    filters.orientation ?? '',
    filters.uploaderId ?? '',
    filters.origin ?? '',
    filters.imageUsage ?? '',
    filters.sort ? toSortParams(filters.sort).join(',') : '',
  ] as const;

/** 無限捲動最多保留幾頁：重新驗證（推播、回到分頁）時 TanStack 依序重抓保留的每一頁，頁數不能無限長。 */
export const GALLERY_INFINITE_MAX_PAGES = 10;

/**
 * 無限捲動的頁參數：游標（第一頁沒有）＋ 這一頁從頭數來是第幾頁。頁碼讓畫面知道丟掉的是哪幾頁
 * （畫面以快照保留它們，docs/architecture/frontend/24-gallery.md §3）。
 */
export interface GalleryInfinitePageParam {
  cursor: string | undefined;
  index: number;
}

/**
 * 無限捲動（docs/architecture/frontend/24-gallery.md §3）：以 keyset 游標接續，捲動途中有人新增或刪除也不重複、不漏。
 * `startAt` 是日期捲軸跳到某個月時的起點：換了起點就是另一份列表（key 不同）。
 * 只保留最近的 `GALLERY_INFINITE_MAX_PAGES` 頁：往下捲時丟掉最前面的頁，往回捲時以 `prevCursor` 抓回來；
 * 第 0 頁之前不往回取（日期捲軸跳過去之後，往前看要回到最前面）。
 */
export const getGalleryItemsInfiniteQueryOptions = (
  filters: GalleryItemFilters,
  options: { startAt?: string; limit?: number } = {},
) => {
  const limit = options.limit ?? GALLERY_PAGE_SIZE;
  return infiniteQueryOptions({
    queryKey: [
      GALLERY_ITEMS_QUERY_KEY,
      'infinite',
      limit,
      options.startAt ?? '',
      ...filterKeys(filters),
    ] as const,
    initialPageParam: { cursor: undefined, index: 0 } as GalleryInfinitePageParam,
    getNextPageParam: (
      lastPage: GalleryItemList,
      _pages,
      lastParam,
    ): GalleryInfinitePageParam | undefined =>
      lastPage.nextCursor ? { cursor: lastPage.nextCursor, index: lastParam.index + 1 } : undefined,
    getPreviousPageParam: (
      firstPage: GalleryItemList,
      _pages,
      firstParam,
    ): GalleryInfinitePageParam | undefined =>
      firstParam.index > 0 && firstPage.prevCursor
        ? { cursor: firstPage.prevCursor, index: firstParam.index - 1 }
        : undefined,
    maxPages: GALLERY_INFINITE_MAX_PAGES,
    queryFn: ({ pageParam, signal }) =>
      fetchGalleryItemsQuery({
        params: {
          ...filters,
          limit,
          cursor: pageParam.cursor,
          startAt: pageParam.cursor ? undefined : options.startAt,
        },
        signal,
      }),
  });
};

/** 一頁（選圖的分頁、精簡的列表）。 */
export const getGalleryItemsQueryOptions = (filters: GalleryItemFilters, limit: number) =>
  queryOptions({
    queryKey: [GALLERY_ITEMS_QUERY_KEY, 'page', limit, ...filterKeys(filters)] as const,
    queryFn: ({ signal }) => fetchGalleryItemsQuery({ params: { ...filters, limit }, signal }),
  });
