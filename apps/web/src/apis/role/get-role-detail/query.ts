import { queryOptions } from '@tanstack/react-query';

import { fetchRoleDetailQuery } from './fetcher';

export const ROLE_DETAIL_QUERY_KEY = 'ROLE_DETAIL_QUERY_KEY';

export const getRoleDetailQueryOptions = (roleId: string) =>
  queryOptions({
    queryKey: [ROLE_DETAIL_QUERY_KEY, roleId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchRoleDetailQuery({ params: { roleId: queryKey[1] }, signal }),
  });
