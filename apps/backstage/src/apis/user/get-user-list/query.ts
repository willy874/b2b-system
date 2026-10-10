import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { UserListParams } from '../types';
import { fetchUserListQuery } from './fetcher';

export const USER_LIST_QUERY_KEY = 'USER_LIST_QUERY_KEY';

const getUserListQueryKeys = (params: UserListParams) =>
  [
    USER_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.keyword,
    params.id?.join(',') ?? '',
    params.status?.join(',') ?? '',
    params.roleId?.join(',') ?? '',
    params.includeGroupRoles ?? false,
    params.mfa ?? '',
    params.tagId?.join(',') ?? '',
    params.orgUnitId ?? '',
    params.includeDescendants ?? false,
    params.sort ? toSortParams(params.sort).join(',') : '',
  ] as const;

export const getUserListQueryOptions = (options: HttpRequestDTO<UserListParams>) =>
  queryOptions({
    queryKey: getUserListQueryKeys(options.params),
    placeholderData: keepPreviousData, // 換頁時不閃空白
    queryFn: ({ signal }) => fetchUserListQuery({ params: options.params, signal }),
  });

/** 使用者選擇器的伺服器端搜尋：前 20 筆（`core/components/UserSearchSelect` 的 `query`）。 */
export const getUserSearchQueryOptions = (keyword: string | undefined) =>
  getUserListQueryOptions({ params: { offset: 0, limit: 20, keyword } });

/** `GET /users` 的 `id` 一次最多幾個（後端 `QueryArraySchema` 的上限）。 */
export const USER_IDS_PER_REQUEST = 50;

/**
 * 以 id 取回使用者（選擇器補已選的人的名稱）：每 `USER_IDS_PER_REQUEST` 人一個請求，不逐人查詢。
 * 回傳每一批的查詢，交給 `useQueries`。
 */
export const getUsersByIdsQueryOptions = (ids: readonly string[]) => {
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += USER_IDS_PER_REQUEST) {
    chunks.push(ids.slice(start, start + USER_IDS_PER_REQUEST));
  }
  return chunks.map((chunk) =>
    getUserListQueryOptions({ params: { offset: 0, limit: chunk.length, id: chunk } }),
  );
};
