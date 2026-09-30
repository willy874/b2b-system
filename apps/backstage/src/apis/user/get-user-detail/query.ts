import { queryOptions } from '@tanstack/react-query';

import { fetchUserDetailQuery } from './fetcher';

export const USER_DETAIL_QUERY_KEY = 'USER_DETAIL_QUERY_KEY';

export const getUserDetailQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: [USER_DETAIL_QUERY_KEY, userId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchUserDetailQuery({ params: { userId: queryKey[1] }, signal }),
  });
