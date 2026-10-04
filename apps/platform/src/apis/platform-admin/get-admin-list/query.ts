import { queryOptions } from '@tanstack/react-query';

import { fetchAdminListQuery } from './fetcher';

export const PLATFORM_ADMIN_LIST_QUERY_KEY = 'PLATFORM_ADMIN_LIST_QUERY_KEY';

/** 所有平台管理者（`platformAdmin:read`）；數量少，不分頁。 */
export const getAdminListQueryOptions = () =>
  queryOptions({
    queryKey: [PLATFORM_ADMIN_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchAdminListQuery({ params: undefined, signal }),
  });
