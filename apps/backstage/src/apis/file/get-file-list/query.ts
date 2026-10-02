import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { HttpRequestDTO } from '@/core/client';
import type { FileListPage } from '@/shared/api-sdk';
import { toSortParams } from '@/shared/constants';

import type { FileListFilters, FileListParams } from '../types';
import { fetchFileListQuery } from './fetcher';

export const FILE_LIST_QUERY_KEY = 'FILE_LIST_QUERY_KEY';
/** 無限捲動的列表：資料形狀（多頁）與分頁列表不同，不能共用 key。 */
export const FILE_INFINITE_LIST_QUERY_KEY = 'FILE_INFINITE_LIST_QUERY_KEY';
/**
 * key 的第二個元素是資料夾（`root` 是根目錄）；不分資料夾的列表放這個值。
 * 檔案的推播帶所在的資料夾，只重抓那個資料夾與不分資料夾的列表（`apis/resources.ts`）。
 */
export const FILE_LIST_ANY_FOLDER = '*';

const filterKeys = (filters: FileListFilters) =>
  [
    filters.keyword,
    filters.contentType,
    filters.category,
    filters.uploaderId,
    filters.tagId?.join(',') ?? '',
    filters.sort ? toSortParams(filters.sort).join(',') : '',
  ] as const;

const getFileListQueryKeys = (params: FileListParams) =>
  [
    FILE_LIST_QUERY_KEY,
    params.folderId ?? FILE_LIST_ANY_FOLDER,
    params.offset,
    params.limit,
    ...filterKeys(params),
  ] as const;

const getFileInfiniteListQueryKeys = (filters: FileListFilters, limit: number) =>
  [
    FILE_INFINITE_LIST_QUERY_KEY,
    filters.folderId ?? FILE_LIST_ANY_FOLDER,
    limit,
    ...filterKeys(filters),
  ] as const;

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
