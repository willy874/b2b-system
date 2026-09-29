import { queryOptions } from '@tanstack/react-query';

import { fetchWorkspaceMeQuery } from './fetcher';

export const WORKSPACE_ME_QUERY_KEY = 'WORKSPACE_ME_QUERY_KEY';

/** 自己在這個工作區的角色與權限鍵（docs/adr/0018-workspace-tenancy.md D17）。 */
export const getWorkspaceMeQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: [WORKSPACE_ME_QUERY_KEY, workspaceId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchWorkspaceMeQuery({ params: { workspaceId: queryKey[1] }, signal }),
  });
