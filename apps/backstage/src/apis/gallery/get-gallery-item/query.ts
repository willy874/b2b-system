import { queryOptions } from '@tanstack/react-query';

import { fetchGalleryItemQuery } from './fetcher';

export const GALLERY_ITEM_QUERY_KEY = 'GALLERY_ITEM_QUERY_KEY';

/** 一張圖的詳情（檢視器的資訊面板、原檔與下載的網址）。 */
export const getGalleryItemQueryOptions = (itemId: string) =>
  queryOptions({
    queryKey: [GALLERY_ITEM_QUERY_KEY, itemId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchGalleryItemQuery({ params: { itemId: queryKey[1] }, signal }),
  });
