import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import { fetchRoleRevisionsQuery } from './fetcher';

export const ROLE_REVISIONS_QUERY_KEY = 'ROLE_REVISIONS_QUERY_KEY';

/** 角色的版本歷史，新的在前（docs/architecture/backend/14-revisions.md §9 R5）。 */
export const getRoleRevisionsQueryOptions = (roleId: string, offset = 0, limit = 20) =>
  queryOptions({
    queryKey: [ROLE_REVISIONS_QUERY_KEY, roleId, offset, limit] as const,
    placeholderData: keepPreviousData,
    queryFn: ({ queryKey, signal }) =>
      fetchRoleRevisionsQuery({
        params: { roleId: queryKey[1], offset: queryKey[2], limit: queryKey[3] },
        signal,
      }),
  });
