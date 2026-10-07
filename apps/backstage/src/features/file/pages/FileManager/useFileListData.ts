import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getFileInfiniteListQueryOptions,
  getFileListQueryOptions,
} from '@/apis/file/get-file-list/query';
import type { FileInfinitePageParam } from '@/apis/file/get-file-list/query';
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
  /** false：不查（例：鎖住的資料夾，查了只會 403）。 */
  enabled?: boolean;
}

/**
 * 分頁與無限捲動兩種閱覽模式的資料來源（docs/architecture/frontend/12-file-manager.md §5）。
 * 同一時間只有一個 query 啟用；切換模式時另一個留在快取，切回來不必重抓。
 */
export function useFileListData({
  mode,
  filters,
  offset,
  pageSize,
  enabled = true,
}: UseFileListDataOptions) {
  const paged = useQuery({
    ...getFileListQueryOptions({ params: { ...filters, offset, limit: pageSize } }),
    enabled: enabled && mode === 'pagination',
  });
  const infinite = useInfiniteQuery({
    ...getFileInfiniteListQueryOptions({ params: { filters, limit: pageSize } }),
    enabled: enabled && mode === 'infinite',
  });

  const files: StoredFile[] = useMemo(
    () =>
      mode === 'pagination' ? (paged.data?.items ?? []) : mergePages(infinite.data?.pages ?? []),
    [mode, paged.data, infinite.data],
  );
  const items = useMemo(() => files.map(toFileItemVM), [files]);
  // 無限捲動只保留最近幾頁（`maxPages`）：前面被丟掉的檔案數＝第一個保留的頁碼 × 每頁筆數，畫面以等量的佔位保留高度
  const firstParam = infinite.data?.pageParams[0] as FileInfinitePageParam | undefined;
  const firstIndex = firstParam?.index ?? 0;
  const dropped = mode === 'infinite' ? Math.max(0, firstIndex) * pageSize : 0;
  // 總數只有不帶游標的第一頁才有：第一頁被丟掉之後沿用最後一次的值（換了條件就重來）
  const infiniteTotal = infinite.data?.pages[0]?.pagination.total;
  const [lastTotal, setLastTotal] = useState<{ filters: FileListFilters; total: number }>();
  if (
    typeof infiniteTotal === 'number' &&
    (lastTotal?.total !== infiniteTotal || lastTotal.filters !== filters)
  ) {
    // render 期間調整 state（不經過 effect）：只在值變了的時候
    setLastTotal({ filters, total: infiniteTotal });
  }
  const total =
    mode === 'pagination'
      ? (paged.data?.pagination.total ?? 0)
      : (infiniteTotal ?? (lastTotal?.filters === filters ? lastTotal.total : 0));
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
  // 捲回佔位區：把丟掉的前一頁抓回來（同時丟掉最後一頁）
  const { hasPreviousPage, isFetchingPreviousPage, fetchPreviousPage } = infinite;
  const loadPrevious = useCallback(() => {
    if (mode === 'infinite' && dropped > 0 && hasPreviousPage && !isFetchingPreviousPage) {
      void fetchPreviousPage();
    }
  }, [dropped, fetchPreviousPage, hasPreviousPage, isFetchingPreviousPage, mode]);

  return {
    items,
    total,
    // 停用的 query 在 TanStack Query 裡也是 pending：不查的時候不要一直轉圈
    isPending: enabled && active.isPending,
    isFetching: active.isFetching,
    error: active.error,
    hasMore: mode === 'infinite' && Boolean(hasNextPage),
    isLoadingMore: mode === 'infinite' && isFetchingNextPage,
    loadMore,
    /** 前面被 `maxPages` 丟掉、還沒抓回來的檔案數（佔位）。 */
    dropped,
    isLoadingPrevious: mode === 'infinite' && isFetchingPreviousPage,
    loadPrevious,
    reportStaleUrl,
    refetch: () => void refetch(),
  };
}
