import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';
import type { FileListPage } from '@/shared/api-sdk';
import { toSortParams } from '@/shared/constants';

import type { FileListFilters, FileListParams, InWorkspace } from '../types';
import { fetchFileListQuery } from './fetcher';

export const FILE_LIST_QUERY_KEY = 'FILE_LIST_QUERY_KEY';
/** 無限捲動的列表：資料形狀（多頁）與分頁列表不同，不能共用 key。 */
export const FILE_INFINITE_LIST_QUERY_KEY = 'FILE_INFINITE_LIST_QUERY_KEY';

const filterKeys = (filters: FileListFilters) =>
  [
    filters.keyword,
    filters.contentType,
    filters.category,
    filters.uploaderId,
    filters.folderId,
    filters.sort ? toSortParams(filters.sort).join(',') : '',
  ] as const;

/** key 帶上工作區：切換工作區時不必清掉整個快取，切回來還能命中（docs/adr/0018-workspace-tenancy.md D17）。 */
const getFileListQueryKeys = (params: InWorkspace & FileListParams) =>
  [
    FILE_LIST_QUERY_KEY,
    params.workspaceId,
    params.offset,
    params.limit,
    ...filterKeys(params),
  ] as const;

const getFileInfiniteListQueryKeys = (
  workspaceId: string,
  filters: FileListFilters,
  limit: number,
) => [FILE_INFINITE_LIST_QUERY_KEY, workspaceId, limit, ...filterKeys(filters)] as const;

export const getFileListQueryOptions = (options: HttpRequestDTO<InWorkspace & FileListParams>) =>
  queryOptions({
    queryKey: getFileListQueryKeys(options.params),
    placeholderData: keepPreviousData, // 換頁時不閃空白
    queryFn: ({ signal }) => fetchFileListQuery({ params: options.params, signal }),
  });

/**
 * 無限捲動：以 keyset 游標（`nextCursor`）接續下一頁，捲動途中有人新增或刪除也不會重複、漏掉
 * （docs/architecture/backend/09-file.md §6.1）。重新驗證時 TanStack 依序以游標重抓已載入的頁數。
 */
export const getFileInfiniteListQueryOptions = (
  options: HttpRequestDTO<InWorkspace & { filters: FileListFilters; limit: number }>,
) =>
  infiniteQueryOptions({
    queryKey: getFileInfiniteListQueryKeys(
      options.params.workspaceId,
      options.params.filters,
      options.params.limit,
    ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: FileListPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    queryFn: ({ signal, pageParam }) =>
      fetchFileListQuery({
        params: {
          workspaceId: options.params.workspaceId,
          ...options.params.filters,
          offset: 0,
          limit: options.params.limit,
          cursor: pageParam,
        },
        signal,
      }),
  });
