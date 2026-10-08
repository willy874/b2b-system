import { queryOptions } from '@tanstack/react-query';

import { fetchTenantUsageQuery } from './fetcher';

export const TENANT_USAGE_QUERY_KEY = 'TENANT_USAGE_QUERY_KEY';

/**
 * 租戶的用量（`tenant:read`）：摘要與近 `days` 天的每日資料（docs/architecture/05-tenancy.md §5.4）。
 * 快照每小時才更新，不必隨租戶的寫入失效。
 */
export const getTenantUsageQueryOptions = (id: string, days: number) =>
  queryOptions({
    queryKey: [TENANT_USAGE_QUERY_KEY, id, days] as const,
    queryFn: ({ signal }) => fetchTenantUsageQuery({ params: { id, days }, signal }),
  });
