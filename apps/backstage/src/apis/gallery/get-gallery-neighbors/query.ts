import { toSortParams } from '@b2b-system/web-shared/constants';
import { queryOptions } from '@tanstack/react-query';

import type { GalleryItemFilters } from '../types';
import { fetchGalleryNeighborsQuery } from './fetcher';

export const GALLERY_NEIGHBORS_QUERY_KEY = 'GALLERY_NEIGHBORS_QUERY_KEY';

/** 從分享的網址直接打開檢視器時，同一個篩選與排序之下的前一張與後一張。 */
export const getGalleryNeighborsQueryOptions = (itemId: string, filters: GalleryItemFilters) =>
  queryOptions({
    queryKey: [
      GALLERY_NEIGHBORS_QUERY_KEY,
      itemId,
      JSON.stringify({ ...filters, sort: filters.sort && toSortParams(filters.sort) }),
    ] as const,
    queryFn: ({ signal }) => fetchGalleryNeighborsQuery({ params: { itemId, filters }, signal }),
  });
