import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';
import type { FileListPage } from '@/shared/api-sdk';
import { toSortParams } from '@/shared/constants';

import type { FileListFilters, FileListParams } from '../types';
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

const getFileListQueryKeys = (params: FileListParams) =>
  [FILE_LIST_QUERY_KEY, params.offset, params.limit, ...filterKeys(params)] as const;

const getFileInfiniteListQueryKeys = (filters: FileListFilters, limit: number) =>
  [FILE_INFINITE_LIST_QUERY_KEY, limit, ...filterKeys(filters)] as const;

export const getFileListQueryOptions = (options: HttpRequestDTO<FileListParams>) =>
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
  options: HttpRequestDTO<{ filters: FileListFilters; limit: number }>,
) =>
  infiniteQueryOptions({
    queryKey: getFileInfiniteListQueryKeys(options.params.filters, options.params.limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: FileListPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    queryFn: ({ signal, pageParam }) =>
      fetchFileListQuery({
        params: {
          ...options.params.filters,
          offset: 0,
          limit: options.params.limit,
          cursor: pageParam,
        },
        signal,
      }),
  });
