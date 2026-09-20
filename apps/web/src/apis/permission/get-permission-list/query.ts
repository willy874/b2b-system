import { queryOptions } from '@tanstack/react-query';

import { fetchPermissionListQuery } from './fetcher';

export const PERMISSION_LIST_QUERY_KEY = 'PERMISSION_LIST_QUERY_KEY';

/** 權限目錄在一個部署版本內不會變。 */
export const getPermissionListQueryOptions = () =>
  queryOptions({
    queryKey: [PERMISSION_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchPermissionListQuery({ params: undefined, signal }),
    staleTime: Infinity,
  });
