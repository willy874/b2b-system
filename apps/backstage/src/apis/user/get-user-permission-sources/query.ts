import { queryOptions } from '@tanstack/react-query';

import { fetchUserPermissionSourcesQuery } from './fetcher';

export const PERMISSION_SOURCES_QUERY_KEY = 'PERMISSION_SOURCES_QUERY_KEY';

/** 有效權限與每個權限的來源（自己，或需要 authz:explain；docs/rbac/01-domain-model.md §9 G4b）。 */
export const getUserPermissionSourcesQueryOptions = (userId: string) =>
  queryOptions({
    queryKey: [PERMISSION_SOURCES_QUERY_KEY, userId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchUserPermissionSourcesQuery({ params: { userId: queryKey[1] }, signal }),
  });
