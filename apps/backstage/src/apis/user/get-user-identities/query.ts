import { queryOptions } from '@tanstack/react-query';

import { fetchUserIdentitiesQuery } from './fetcher';

export const USER_IDENTITIES_QUERY_KEY = 'USER_IDENTITIES_QUERY_KEY';

export const getUserIdentitiesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: [USER_IDENTITIES_QUERY_KEY, userId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchUserIdentitiesQuery({ params: { userId: queryKey[1] }, signal }),
  });
