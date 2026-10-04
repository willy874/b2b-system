import { queryOptions } from '@tanstack/react-query';

import { fetchPlatformJobQuery } from './fetcher';

export const PLATFORM_JOB_DETAIL_QUERY_KEY = 'PLATFORM_JOB_DETAIL_QUERY_KEY';

/** 一筆工作，帶 `data` 與 `output`（列表不帶這兩欄）。 */
export const getPlatformJobQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [PLATFORM_JOB_DETAIL_QUERY_KEY, id] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchPlatformJobQuery({ params: { id: queryKey[1] }, signal }),
  });
