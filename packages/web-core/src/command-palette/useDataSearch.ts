import { useQueries } from '@tanstack/react-query';

import type { SearchProvider, SearchResult } from './registry';

/** 停止打字多久才發請求：每個提供者一個請求，打一個字就發 N 個太多。 */
export const SEARCH_DEBOUNCE_MS = 250;

/** 結果只在面板開著時有用，短暫快取讓「刪掉一個字又打回來」不必重抓。 */
const SEARCH_STALE_MS = 30_000;

export const COMMAND_PALETTE_SEARCH_QUERY_KEY = 'COMMAND_PALETTE_SEARCH_QUERY_KEY';

export interface DataSearchState {
  provider: SearchProvider;
  status: 'idle' | 'loading' | 'error' | 'success';
  results: SearchResult[];
}

/**
 * 每個提供者各發一個請求，各自顯示（一個慢或失敗不擋其他）。查詢字串改變時，舊的查詢失去觀察者，
 * TanStack Query 以 `signal` 中止它（提供者有把 `signal` 交給 fetch）；空字串不搜尋。
 */
export function useDataSearch(query: string, providers: SearchProvider[]): DataSearchState[] {
  const results = useQueries({
    queries: providers.map((provider) => ({
      queryKey: [COMMAND_PALETTE_SEARCH_QUERY_KEY, provider.key, query] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => provider.search(query, signal),
      enabled: query !== '',
      staleTime: SEARCH_STALE_MS,
      // 搜尋失敗就顯示失敗，不要讓使用者等三次重試
      retry: false,
    })),
  });
  return providers.map((provider, index) => {
    const result = results[index];
    if (query === '' || !result) return { provider, status: 'idle', results: [] };
    if (result.isError) return { provider, status: 'error', results: [] };
    if (result.data) return { provider, status: 'success', results: result.data };
    return { provider, status: 'loading', results: [] };
  });
}
