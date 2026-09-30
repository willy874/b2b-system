import { queryOptions } from '@tanstack/react-query';

import { fetchNotificationUnreadCountQuery } from './fetcher';

export const NOTIFICATION_UNREAD_COUNT_QUERY_KEY = 'NOTIFICATION_UNREAD_COUNT_QUERY_KEY';

/**
 * 頂列鈴鐺的未讀數。只從伺服器取得、不存 localStorage（docs/architecture/frontend/09-state-and-storage.md §4.2）；
 * 新通知與已讀由推播讓它失效（`apis/resources.ts`）。
 */
export const getNotificationUnreadCountQueryOptions = () =>
  queryOptions({
    queryKey: [NOTIFICATION_UNREAD_COUNT_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchNotificationUnreadCountQuery({ params: undefined, signal }),
  });
