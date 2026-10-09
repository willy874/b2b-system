import { queryOptions } from '@tanstack/react-query';

import { fetchStorageTotalQuery } from './fetcher';

export const STORAGE_TOTAL_QUERY_KEY = 'STORAGE_TOTAL_QUERY_KEY';

/**
 * 儲存的止水線（`tenant:read`）：所有租戶的已用量合計與上限（docs/architecture/backend/25-image.md §12）。
 * 背景工作每 5 分鐘才彙總一次，不必隨租戶的寫入失效；一分鐘內不重抓。
 */
export const getStorageTotalQueryOptions = () =>
  queryOptions({
    queryKey: [STORAGE_TOTAL_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchStorageTotalQuery({ params: undefined, signal }),
    staleTime: 60_000,
  });
