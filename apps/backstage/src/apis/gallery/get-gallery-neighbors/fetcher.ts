import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';

import { getGalleryItemControllerNeighborsUrl } from '@/shared/api-sdk';
import type { GalleryNeighbors } from '@/shared/api-sdk';

import type { GalleryItemFilters } from '../types';

export const fetchGalleryNeighborsQuery = defineAuthFetcher<
  HttpRequestDTO<{ itemId: string; filters: GalleryItemFilters }>,
  GalleryNeighbors
>((http, request) => {
  const { itemId, filters } = request.params;
  return http.request(
    withQuery(getGalleryItemControllerNeighborsUrl({ id: itemId }), {
      ...filters,
      sort: filters.sort && toSortParams(filters.sort),
    }),
    { method: 'GET' },
  );
});
