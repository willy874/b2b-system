import { toSortParams } from '@b2b-system/web-shared/constants';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { TenantListParams } from '../types';
import { fetchTenantListQuery } from './fetcher';

export const TENANT_LIST_QUERY_KEY = 'TENANT_LIST_QUERY_KEY';

const getTenantListQueryKeys = (params: TenantListParams) =>
  [
    TENANT_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.q,
    params.status,
    params.sort ? toSortParams(params.sort).join(',') : '',
  ] as const;

/** 租戶清單（`tenant:read`）：伺服器分頁、代碼／名稱／網域搜尋、狀態篩選與排序；每列帶用量摘要。 */
export const getTenantListQueryOptions = (params: TenantListParams) =>
  queryOptions({
    queryKey: getTenantListQueryKeys(params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchTenantListQuery({ params, signal }),
  });
