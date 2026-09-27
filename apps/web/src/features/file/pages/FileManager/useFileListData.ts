import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  getFileInfiniteListQueryOptions,
  getFileListQueryOptions,
} from '@/apis/file/get-file-list/query';
import type { FileListFilters } from '@/apis/file/types';
import type { StoredFile } from '@/shared/api-sdk';

import type { FilePagingMode } from '../../preference';
import { earliestUrlExpiry, mergePages, toFileItemVM } from './adapter';

/** 網址失效前多久重抓：列表上的縮圖在失效前換成新網址。 */
const URL_REFRESH_LEAD_MS = 60_000;
/** 重抓的最短間隔（網址已過期、時鐘偏差時避免連續重抓）。 */
const MIN_REFRESH_DELAY_MS = 5_000;

interface UseFileListDataOptions {
  mode: FilePagingMode;
  filters: FileListFilters;
  offset: number;
  pageSize: number;
}

/**
 * 分頁與無限捲動兩種閱覽模式的資料來源（docs/architecture/frontend/12-file-manager.md §5）。
 * 同一時間只有一個 query 啟用；切換模式時另一個留在快取，切回來不必重抓。
 */
export function useFileListData({ mode, filters, offset, pageSize }: UseFileListDataOptions) {
  const paged = useQuery({
    ...getFileListQueryOptions({ params: { ...filters, offset, limit: pageSize } }),
    enabled: mode === 'pagination',
  });
  const infinite = useInfiniteQuery({
    ...getFileInfiniteListQueryOptions({ params: { filters, limit: pageSize } }),
    enabled: mode === 'infinite',
  });

  const files: StoredFile[] = useMemo(
    () =>
      mode === 'pagination' ? (paged.data?.items ?? []) : mergePages(infinite.data?.pages ?? []),
    [mode, paged.data, infinite.data],
  );
  const items = useMemo(() => files.map(toFileItemVM), [files]);
  const total =
    mode === 'pagination'
      ? (paged.data?.pagination.total ?? 0)
      : (infinite.data?.pages[0]?.pagination.total ?? 0);
  const active = mode === 'pagination' ? paged : infinite;

  // presigned 網址有效期有限（FILE_URL_TTL）：失效前重抓一次，縮圖不會在久開的頁面上變成破圖
  const refetch = active.refetch;
  const expiry = earliestUrlExpiry(files);
  useEffect(() => {
    if (expiry === undefined) return undefined;
    const delay = Math.max(MIN_REFRESH_DELAY_MS, expiry - Date.now() - URL_REFRESH_LEAD_MS);
    const timer = setTimeout(() => void refetch(), delay);
    return () => clearTimeout(timer);
  }, [expiry, refetch]);

  // 縮圖載入失敗（網址被提早撤銷、時鐘偏差）時重抓，但同一批資料只重抓一次
  const refreshedFor = useRef<unknown>(undefined);
  const data = active.data;
  const reportStaleUrl = useCallback(() => {
    if (refreshedFor.current === data) return;
    refreshedFor.current = data;
    void refetch();
  }, [data, refetch]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = infinite;
  const loadMore = useCallback(() => {
    if (mode === 'infinite' && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, mode]);

  return {
    items,
    total,
    isPending: active.isPending,
    isFetching: active.isFetching,
    error: active.error,
    hasMore: mode === 'infinite' && Boolean(hasNextPage),
    isLoadingMore: mode === 'infinite' && isFetchingNextPage,
    loadMore,
    reportStaleUrl,
    refetch: () => void refetch(),
  };
}
