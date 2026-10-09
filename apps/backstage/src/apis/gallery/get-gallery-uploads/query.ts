import { queryOptions } from '@tanstack/react-query';

import { fetchGalleryUploadsQuery } from './fetcher';

export const GALLERY_UPLOADS_QUERY_KEY = 'GALLERY_UPLOADS_QUERY_KEY';

/** 自己上傳中與處理失敗的（頁首的「處理中 N 張」）。 */
export const getGalleryUploadsQueryOptions = () =>
  queryOptions({
    queryKey: [GALLERY_UPLOADS_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchGalleryUploadsQuery({ params: {}, signal }),
  });
