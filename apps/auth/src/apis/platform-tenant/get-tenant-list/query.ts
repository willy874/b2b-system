import { queryOptions } from '@tanstack/react-query';

import { fetchTenantListQuery } from './fetcher';

export const TENANT_LIST_QUERY_KEY = 'TENANT_LIST_QUERY_KEY';

/** 所有租戶（`tenant:read`）；數量少，不分頁。 */
export const getTenantListQueryOptions = () =>
  queryOptions({
    queryKey: [TENANT_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchTenantListQuery({ params: undefined, signal }),
  });
