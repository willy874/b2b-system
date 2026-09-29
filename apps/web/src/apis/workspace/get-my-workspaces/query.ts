import { queryOptions } from '@tanstack/react-query';

import { fetchMyWorkspacesQuery } from './fetcher';

export const MY_WORKSPACE_LIST_QUERY_KEY = 'MY_WORKSPACE_LIST_QUERY_KEY';

/** 自己能進入的工作區（切換器、以 slug 解析網址）。 */
export const getMyWorkspacesQueryOptions = () =>
  queryOptions({
    queryKey: [MY_WORKSPACE_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchMyWorkspacesQuery({ params: undefined, signal }),
  });
