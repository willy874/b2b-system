import { queryOptions } from '@tanstack/react-query';

import { fetchTenantQuery } from './fetcher';

export const TENANT_DETAIL_QUERY_KEY = 'TENANT_DETAIL_QUERY_KEY';

/**
 * 一個租戶。佈建中時每 2 秒重抓一次，直到佈建完成或失敗
 * （佈建是背景工作，docs/architecture/05-tenancy.md §10.2 D12）。
 */
export const getTenantQueryOptions = (id: string) =>
  queryOptions({
    queryKey: [TENANT_DETAIL_QUERY_KEY, id] as const,
    queryFn: ({ signal }) => fetchTenantQuery({ params: { id }, signal }),
    refetchInterval: (query) => (query.state.data?.status === 'provisioning' ? 2000 : false),
  });
