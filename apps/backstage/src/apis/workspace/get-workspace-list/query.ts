import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';
import { toSortParams } from '@/shared/constants';

import type { WorkspaceListParams } from '../types';
import { fetchWorkspaceListQuery } from './fetcher';

export const WORKSPACE_LIST_QUERY_KEY = 'WORKSPACE_LIST_QUERY_KEY';

const getWorkspaceListQueryKeys = (params: WorkspaceListParams) =>
  [
    WORKSPACE_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.keyword,
    params.sort ? toSortParams(params.sort).join(',') : '',
  ] as const;

/** 平台管理員的工作區清單（`workspace:read`）。 */
export const getWorkspaceListQueryOptions = (options: HttpRequestDTO<WorkspaceListParams>) =>
  queryOptions({
    queryKey: getWorkspaceListQueryKeys(options.params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchWorkspaceListQuery({ params: options.params, signal }),
  });
