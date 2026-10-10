import { fetchAllPages } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

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
    params.sort ? toSortParams(params.sort).join(',') : '',
  ] as const;

export const getRoleListQueryOptions = (options: HttpRequestDTO<RoleListParams>) =>
  queryOptions({
    queryKey: getRoleListQueryKeys(options.params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchRoleListQuery({ params: options.params, signal }),
  });

/** 角色選擇器：取回所有角色（資料量小，依名稱排序）。 */
export const getRoleOptionsQueryOptions = () =>
  queryOptions({
    queryKey: [ROLE_OPTIONS_QUERY_KEY] as const,
    // 選擇器在本地過濾：取完所有分頁，名稱排在第 200 個之後的角色也選得到
    queryFn: ({ signal }) =>
      fetchAllPages((offset, limit) =>
        fetchRoleListQuery({
          params: { offset, limit, sort: [{ sort: 'name', order: 'asc' }] },
          signal,
        }),
      ),
    staleTime: 60_000,
  });
