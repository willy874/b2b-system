import { queryOptions } from '@tanstack/react-query';

import { fetchCurrentTenantQuery } from './fetcher';

export const CURRENT_TENANT_QUERY_KEY = 'CURRENT_TENANT_QUERY_KEY';

/** 這個網域的租戶；一個分頁的生命週期內不會變（換租戶＝換網域）。 */
export const getCurrentTenantQueryOptions = () =>
  queryOptions({
    queryKey: [CURRENT_TENANT_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchCurrentTenantQuery({ params: undefined, signal }),
    staleTime: Number.POSITIVE_INFINITY,
  });
