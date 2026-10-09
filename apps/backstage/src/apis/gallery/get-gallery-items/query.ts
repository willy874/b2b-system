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

/**
 * 無限捲動（docs/architecture/frontend/24-gallery.md §3）：以 keyset 游標接續，捲動途中有人新增或刪除也不重複、不漏。
 * `startAt` 是日期捲軸跳到某個月時的起點：換了起點就是另一份列表（key 不同）。
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
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: GalleryItemList) => lastPage.nextCursor ?? undefined,
    queryFn: ({ pageParam, signal }) =>
      fetchGalleryItemsQuery({
        params: {
          ...filters,
          limit,
          cursor: pageParam,
          startAt: pageParam ? undefined : options.startAt,
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
