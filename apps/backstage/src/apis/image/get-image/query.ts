import { queryOptions } from '@tanstack/react-query';

import { fetchImageQuery } from './fetcher';

export const IMAGE_DETAIL_QUERY_KEY = 'IMAGE_DETAIL_QUERY_KEY';

/** 自己建立的一張圖片（處理狀態、主檔的網址）。 */
export const getImageQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [IMAGE_DETAIL_QUERY_KEY, id] as const,
    queryFn: ({ queryKey, signal }) => fetchImageQuery({ params: { id: queryKey[1] }, signal }),
  });
