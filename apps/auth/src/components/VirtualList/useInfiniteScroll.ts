import { useCallback, useEffect, useRef } from 'react';

import { useLatestRef } from '../useLatestRef';

export interface UseInfiniteScrollOptions {
  scrollElement: HTMLElement | null;
  /** 目前已載入的筆數；筆數增加代表上一頁已到，可以再要下一頁。 */
  count: number;
  /** 還有下一頁。未設定視為沒有。 */
  hasMore?: boolean;
  /** 正在載入下一頁；期間不會重複觸發。 */
  loading?: boolean;
  onLoadMore?: () => void;
  /** 距離底部多少 px 內就觸發。 */
  threshold?: number;
  /**
   * 資料集換掉（例如搜尋關鍵字改變、從第一頁重新載入）時換一個值：
   * 解除「同一筆數只觸發一次」的鎖，新的第一頁筆數剛好等於舊筆數時才不會卡住。
   */
  resetKey?: unknown;
}

/**
 * 捲到接近底部時呼叫 `onLoadMore`。
 *
 * - 同一個 `count` 只觸發一次，呼叫端還沒把 `loading` 設起來之前也不會連發。
 * - `loading` 由 true 變回 false 而筆數沒變（例如載入失敗）時，等使用者 **再捲動** 才重試，
 *   不會自動重打（避免錯誤時無限重試）。
 * - 內容不足以捲動（第一頁太短、或尚未載入任何資料）時，掛上或筆數變化後會自動再要一頁，直到填滿。
 *
 * 回傳的 `onScroll` 要掛在捲動容器上（React 的 scroll 事件不冒泡，掛在容器本身）。
 */
interface LoadState {
  count: number;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: (() => void) | undefined;
  threshold: number;
}

export function useInfiniteScroll({
  scrollElement,
  count,
  hasMore = false,
  loading = false,
  onLoadMore,
  threshold = 64,
  resetKey,
}: UseInfiniteScrollOptions): { onScroll: () => void } {
  const requestedAt = useRef<number | null>(null);
  const latest = useLatestRef<LoadState>({ count, hasMore, loading, onLoadMore, threshold });

  const check = useCallback(
    (state: LoadState) => {
      if (!scrollElement || !state.onLoadMore || !state.hasMore || state.loading) return;
      if (requestedAt.current === state.count) return;
      const distance =
        scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight;
      if (distance > state.threshold) return;
      requestedAt.current = state.count;
      state.onLoadMore();
    },
    [scrollElement],
  );

  const wasLoading = useRef(loading);
  const canRetry = useRef(false);
  useEffect(() => {
    if (wasLoading.current && !loading) canRetry.current = true;
    wasLoading.current = loading;
  }, [loading]);

  // 掛上、筆數或狀態改變後檢查一次：內容不滿一屏時自動再要一頁
  const lastResetKey = useRef(resetKey);
  useEffect(() => {
    if (lastResetKey.current !== resetKey) {
      lastResetKey.current = resetKey;
      requestedAt.current = null;
    }
    check({ count, hasMore, loading, onLoadMore, threshold });
  }, [check, count, hasMore, loading, onLoadMore, threshold, resetKey]);

  const onScroll = useCallback(() => {
    if (canRetry.current) {
      canRetry.current = false;
      requestedAt.current = null;
    }
    check(latest.current);
  }, [check, latest]);

  return { onScroll };
}
