import { fetchAllPages } from '@b2b-system/web-core/client';
import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

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

/** 群組選擇器：取回所有群組（數量少，依名稱排序）。 */
export const getGroupOptionsQueryOptions = () =>
  queryOptions({
    queryKey: [GROUP_OPTIONS_QUERY_KEY] as const,
    // 選擇器在本地過濾：取完所有分頁，名稱排在第 200 個之後的群組也選得到
    queryFn: ({ signal }) =>
      fetchAllPages((offset, limit) =>
        fetchGroupListQuery({
          params: { offset, limit, sort: [{ sort: 'name', order: 'asc' }] },
          signal,
        }),
      ),
    staleTime: 60_000,
  });
