import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';
import { toSortParams } from '@/shared/constants';

import type { GroupListParams } from '../types';
import { fetchGroupListQuery } from './fetcher';

export const GROUP_LIST_QUERY_KEY = 'GROUP_LIST_QUERY_KEY';
/** 選擇器用的清單（加入巢狀群組）：與列表頁刻意不共用快取。 */
export const GROUP_OPTIONS_QUERY_KEY = 'GROUP_OPTIONS_QUERY_KEY';

const getGroupListQueryKeys = (params: GroupListParams) =>
  [
    GROUP_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.keyword,
    params.userId,
    params.roleId,
    params.sort ? toSortParams(params.sort).join(',') : '',
  ] as const;

export const getGroupListQueryOptions = (options: HttpRequestDTO<GroupListParams>) =>
  queryOptions({
    queryKey: getGroupListQueryKeys(options.params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchGroupListQuery({ params: options.params, signal }),
  });

/** 群組選擇器：一次抓足夠多，群組數量少。 */
export const getGroupOptionsQueryOptions = () =>
  queryOptions({
    queryKey: [GROUP_OPTIONS_QUERY_KEY] as const,
    queryFn: ({ signal }) =>
      fetchGroupListQuery({
        params: { offset: 0, limit: 200, sort: [{ sort: 'name', order: 'asc' }] },
        signal,
      }),
    staleTime: 60_000,
  });
