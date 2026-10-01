import { queryOptions } from '@tanstack/react-query';

import { fetchUserApiTokensQuery } from './fetcher';

export const USER_API_TOKENS_QUERY_KEY = 'USER_API_TOKENS_QUERY_KEY';

export const getUserApiTokensQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: [USER_API_TOKENS_QUERY_KEY, userId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchUserApiTokensQuery({ params: { userId: queryKey[1] }, signal }),
  });
