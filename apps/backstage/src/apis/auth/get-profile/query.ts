import { queryOptions } from '@tanstack/react-query';

import { fetchProfileQuery } from './fetcher';

export const AUTH_PROFILE_QUERY_KEY = 'AUTH_PROFILE_QUERY_KEY';

/** 權限變更的偵測窗口：5 分鐘 ＋ 視窗聚焦時重取。 */
export const getAuthProfileQueryOptions = () =>
  queryOptions({
    queryKey: [AUTH_PROFILE_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchProfileQuery({ params: undefined, signal }),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
