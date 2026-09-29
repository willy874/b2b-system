import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';
import { toSortParams } from '@/shared/constants';

import type { WorkspaceMemberListParams } from '../types';
import { fetchWorkspaceMemberListQuery } from './fetcher';

export const WORKSPACE_MEMBER_LIST_QUERY_KEY = 'WORKSPACE_MEMBER_LIST_QUERY_KEY';

/** key 帶上工作區：切換工作區時不必清掉整個快取，切回來還能命中（D17）。 */
const getWorkspaceMemberListQueryKeys = (params: WorkspaceMemberListParams) =>
  [
    WORKSPACE_MEMBER_LIST_QUERY_KEY,
    params.workspaceId,
    params.offset,
    params.limit,
    params.keyword,
    params.roleId,
    params.sort ? toSortParams(params.sort).join(',') : '',
  ] as const;

export const getWorkspaceMemberListQueryOptions = (
  options: HttpRequestDTO<WorkspaceMemberListParams>,
) =>
  queryOptions({
    queryKey: getWorkspaceMemberListQueryKeys(options.params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchWorkspaceMemberListQuery({ params: options.params, signal }),
  });
