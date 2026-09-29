import { queryOptions } from '@tanstack/react-query';

import { fetchWorkspaceRoleListQuery } from './fetcher';

export const WORKSPACE_ROLE_LIST_QUERY_KEY = 'WORKSPACE_ROLE_LIST_QUERY_KEY';

/** 可以指派的工作區角色（每個工作區看到的相同，但路由在工作區底下）。 */
export const getWorkspaceRoleListQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: [WORKSPACE_ROLE_LIST_QUERY_KEY, workspaceId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchWorkspaceRoleListQuery({ params: { workspaceId: queryKey[1] }, signal }),
  });
