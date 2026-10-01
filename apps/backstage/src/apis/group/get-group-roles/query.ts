import { queryOptions } from '@tanstack/react-query';

import { fetchGroupRolesQuery } from './fetcher';

export const GROUP_ROLES_QUERY_KEY = 'GROUP_ROLES_QUERY_KEY';

export const getGroupRolesQueryOptions = (groupId: string) =>
  queryOptions({
    queryKey: [GROUP_ROLES_QUERY_KEY, groupId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchGroupRolesQuery({ params: { groupId: queryKey[1] }, signal }),
  });
