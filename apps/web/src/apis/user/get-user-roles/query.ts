import { queryOptions } from '@tanstack/react-query';

import { fetchUserRolesQuery } from './fetcher';

export const USER_ROLES_QUERY_KEY = 'USER_ROLES_QUERY_KEY';

export const getUserRolesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: [USER_ROLES_QUERY_KEY, userId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchUserRolesQuery({ params: { userId: queryKey[1] }, signal }),
  });
