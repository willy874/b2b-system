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
    params.status?.join(',') ?? '',
    params.roleId?.join(',') ?? '',
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
