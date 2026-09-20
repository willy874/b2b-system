import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';

import type { RoleListParams } from '../types';
import { fetchRoleListQuery } from './fetcher';

export const ROLE_LIST_QUERY_KEY = 'ROLE_LIST_QUERY_KEY';
/** 選擇器用的無限捲動清單：與列表頁刻意不共用快取。 */
export const ROLE_OPTIONS_QUERY_KEY = 'ROLE_OPTIONS_QUERY_KEY';

const getRoleListQueryKeys = (params: RoleListParams) =>
  [
    ROLE_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.keyword,
    params.isSystem,
    params.sortBy,
    params.sortOrder,
  ] as const;

export const getRoleListQueryOptions = (options: HttpRequestDTO<RoleListParams>) =>
  queryOptions({
    queryKey: getRoleListQueryKeys(options.params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchRoleListQuery({ params: options.params, signal }),
  });

/** 角色選擇器：一次抓足夠多，資料量小。 */
export const getRoleOptionsQueryOptions = () =>
  queryOptions({
    queryKey: [ROLE_OPTIONS_QUERY_KEY] as const,
    queryFn: ({ signal }) =>
      fetchRoleListQuery({
        params: { offset: 0, limit: 200, sortBy: 'name', sortOrder: 'asc' },
        signal,
      }),
    staleTime: 60_000,
  });
