import { AppQueryClient } from './AppQueryClient';

export const queryClient = new AppQueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: false, // 重試交給 plugins/fetcher/retry.ts（它懂哪些該重試）
      refetchOnWindowFocus: true,
      throwOnError: false, // 錯誤由 UI 呈現，不炸到 error boundary
    },
    mutations: { retry: false },
  },
});
