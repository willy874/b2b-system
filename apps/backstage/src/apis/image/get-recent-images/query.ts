import { queryOptions } from '@tanstack/react-query';

import { fetchRecentImagesQuery } from './fetcher';

/** 第二個元素是用途 id。 */
export const RECENT_IMAGE_LIST_QUERY_KEY = 'RECENT_IMAGE_LIST_QUERY_KEY';

/** 最近使用的圖片（自己建立過的，最多 30 張；docs/architecture/backend/25-image.md §15.7）。 */
export const getRecentImagesQueryOptions = (usage: string) =>
  queryOptions({
    queryKey: [RECENT_IMAGE_LIST_QUERY_KEY, usage] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchRecentImagesQuery({ params: { usage: queryKey[1] }, signal }),
    staleTime: 60_000,
  });
