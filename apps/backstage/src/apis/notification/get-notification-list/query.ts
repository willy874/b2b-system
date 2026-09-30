import { infiniteQueryOptions } from '@tanstack/react-query';

import type { NotificationPage } from '@/shared/api-sdk';

import type { NotificationFilter } from '../types';
import { fetchNotificationListQuery } from './fetcher';

export const NOTIFICATION_LIST_QUERY_KEY = 'NOTIFICATION_LIST_QUERY_KEY';

const getNotificationListQueryKeys = (filter: NotificationFilter, limit: number) =>
  [NOTIFICATION_LIST_QUERY_KEY, filter, limit] as const;

/**
 * 無限捲動：以 keyset 游標（`nextCursor`）接續下一頁。通知會在捲動途中不斷新增在最前面，
 * offset 會讓下一頁重複前一頁的最後幾筆（docs/architecture/backend/15-notification.md §6）。
 * 推播讓它失效時，TanStack 依序以游標重抓已載入的頁數。
 */
export const getNotificationListQueryOptions = (params: {
  filter: NotificationFilter;
  limit: number;
}) =>
  infiniteQueryOptions({
    queryKey: getNotificationListQueryKeys(params.filter, params.limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: NotificationPage) => lastPage.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) =>
      fetchNotificationListQuery({ params: { ...params, cursor: pageParam }, signal }),
  });
