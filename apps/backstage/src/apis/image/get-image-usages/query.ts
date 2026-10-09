import { queryOptions } from '@tanstack/react-query';

import { fetchImageUsagesQuery } from './fetcher';

export const IMAGE_USAGE_LIST_QUERY_KEY = 'IMAGE_USAGE_LIST_QUERY_KEY';

/** 每個使用圖片的地方的限制；部署更新才會變（docs/architecture/backend/25-image.md §16.2 D8）。 */
export const getImageUsagesQueryOptions = () =>
  queryOptions({
    queryKey: [IMAGE_USAGE_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchImageUsagesQuery({ params: undefined, signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });
