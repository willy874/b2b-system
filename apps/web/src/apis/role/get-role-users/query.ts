import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { fetchRoleUsersQuery } from './fetcher';

export const ROLE_USERS_QUERY_KEY = 'ROLE_USERS_QUERY_KEY';

export const getRoleUsersQueryOptions = (roleId: string, offset = 0, limit = 20) =>
  queryOptions({
    queryKey: [ROLE_USERS_QUERY_KEY, roleId, offset, limit] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ queryKey, signal }) =>
      fetchRoleUsersQuery({
        params: { roleId: queryKey[1], offset: queryKey[2], limit: queryKey[3] },
        signal,
      }),
  });
