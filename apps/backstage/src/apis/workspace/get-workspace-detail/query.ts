import { queryOptions } from '@tanstack/react-query';

import { fetchWorkspaceDetailQuery } from './fetcher';

export const WORKSPACE_DETAIL_QUERY_KEY = 'WORKSPACE_DETAIL_QUERY_KEY';

export const getWorkspaceDetailQueryOptions = (workspaceId: string) =>
  queryOptions({
    queryKey: [WORKSPACE_DETAIL_QUERY_KEY, workspaceId] as const,
    queryFn: ({ queryKey, signal }) =>
      fetchWorkspaceDetailQuery({ params: { workspaceId: queryKey[1] }, signal }),
  });
