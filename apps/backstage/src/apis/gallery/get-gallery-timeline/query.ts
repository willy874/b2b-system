import { queryOptions } from '@tanstack/react-query';

import type { GalleryItemFilters } from '../types';
import { fetchGalleryTimelineQuery } from './fetcher';

export const GALLERY_TIMELINE_QUERY_KEY = 'GALLERY_TIMELINE_QUERY_KEY';

/** 每個月的張數（日期捲軸）。 */
export const getGalleryTimelineQueryOptions = (
  filters: Omit<GalleryItemFilters, 'sort'>,
  field: 'sortAt' | 'createdAt',
) =>
  queryOptions({
    queryKey: [
      GALLERY_TIMELINE_QUERY_KEY,
      field,
      filters.keyword ?? '',
      filters.albumId ?? '',
      filters.tagId?.join(',') ?? '',
      filters.takenFrom ?? '',
      filters.takenTo ?? '',
      filters.orientation ?? '',
      filters.uploaderId ?? '',
      filters.origin ?? '',
    ] as const,
    queryFn: ({ signal }) => fetchGalleryTimelineQuery({ params: { ...filters, field }, signal }),
  });
