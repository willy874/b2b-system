import { defineAuthFetcher, withQuery } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';

import { getGalleryItemControllerTimelineUrl } from '@/shared/api-sdk';
import type { GalleryTimeline } from '@/shared/api-sdk';

import type { GalleryItemFilters } from '../types';

export const fetchGalleryTimelineQuery = defineAuthFetcher<
  HttpRequestDTO<Omit<GalleryItemFilters, 'sort'> & { field: 'sortAt' | 'createdAt' }>,
  GalleryTimeline
>((http, request) =>
  http.request(withQuery(getGalleryItemControllerTimelineUrl(), { ...request.params }), {
    method: 'GET',
  }),
);
