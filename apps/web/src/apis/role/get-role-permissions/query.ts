import { queryOptions } from '@tanstack/react-query';

import { fetchRolePermissionsQuery } from './fetcher';

export const ROLE_PERMISSIONS_QUERY_KEY = 'ROLE_PERMISSIONS_QUERY_KEY';

export const getRolePermissionsQueryOptions = (roleId: string) =>
  queryOptions({
    queryKey: [ROLE_PERMISSIONS_QUERY_KEY, roleId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchRolePermissionsQuery({ params: { roleId: queryKey[1] }, signal }),
  });
