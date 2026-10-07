import type { HttpRequestDTO } from '@b2b-system/web-core/client';
import { toSortParams } from '@b2b-system/web-shared/constants';
import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { FileListPage } from '@/shared/api-sdk';

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

/** 無限捲動最多保留幾頁：重新驗證（推播、回到分頁）時 TanStack 依序重抓保留的每一頁，頁數不能無限長。 */
export const FILE_INFINITE_MAX_PAGES = 10;

/**
 * 無限捲動的頁參數：游標（第一頁沒有）＋ 這一頁從頭數來是第幾頁。頁碼讓畫面知道前面被丟掉了多少頁，
 * 以等量的佔位保留高度（docs/architecture/frontend/12-file-manager.md §5）。
 */
export interface FileInfinitePageParam {
  cursor: string | undefined;
  index: number;
}

/**
 * 無限捲動：以 keyset 游標接續（`nextCursor`／`prevCursor`），捲動途中有人新增或刪除也不會重複、漏掉
 * （docs/architecture/backend/09-file.md §6.1）。只保留最近的 `FILE_INFINITE_MAX_PAGES` 頁：往下捲時丟掉最前面的頁，
 * 往回捲到佔位區時以 `prevCursor` 抓回來。
 */
export const getFileInfiniteListQueryOptions = (
  options: HttpRequestDTO<{ filters: FileListFilters; limit: number }>,
) =>
  infiniteQueryOptions({
    queryKey: getFileInfiniteListQueryKeys(options.params.filters, options.params.limit),
    initialPageParam: { cursor: undefined, index: 0 } as FileInfinitePageParam,
    getNextPageParam: (
      lastPage: FileListPage,
      _pages,
      lastParam,
    ): FileInfinitePageParam | undefined =>
      lastPage.nextCursor ? { cursor: lastPage.nextCursor, index: lastParam.index + 1 } : undefined,
    getPreviousPageParam: (
      firstPage: FileListPage,
      _pages,
      firstParam,
    ): FileInfinitePageParam | undefined =>
      firstPage.prevCursor
        ? { cursor: firstPage.prevCursor, index: firstParam.index - 1 }
        : undefined,
    maxPages: FILE_INFINITE_MAX_PAGES,
    placeholderData: keepPreviousData,
    queryFn: ({ signal, pageParam }) =>
      fetchFileListQuery({
        params: {
          ...options.params.filters,
          offset: 0,
          limit: options.params.limit,
          cursor: pageParam.cursor,
        },
        signal,
      }),
  });
