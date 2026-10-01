import { queryOptions } from '@tanstack/react-query';

import { fetchMyApiTokensQuery } from './fetcher';

export const MY_API_TOKENS_QUERY_KEY = 'MY_API_TOKENS_QUERY_KEY';

export const getMyApiTokensQueryOptions = () =>
  queryOptions({
    queryKey: [MY_API_TOKENS_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchMyApiTokensQuery({ params: undefined, signal }),
  });
