import { queryOptions } from '@tanstack/react-query';

import { fetchGalleryAlbumsQuery } from './fetcher';

export const GALLERY_ALBUMS_QUERY_KEY = 'GALLERY_ALBUMS_QUERY_KEY';

/** 所有相簿（數量少，一次取完）：相簿列表、加入相簿的選擇、篩選。 */
export const getGalleryAlbumsQueryOptions = () =>
  queryOptions({
    queryKey: [GALLERY_ALBUMS_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchGalleryAlbumsQuery({ params: {}, signal }),
  });
