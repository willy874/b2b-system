import { queryOptions } from '@tanstack/react-query';

import { fetchNotificationUnreadCountQuery } from './fetcher';

export const PLATFORM_NOTIFICATION_UNREAD_COUNT_QUERY_KEY =
  'PLATFORM_NOTIFICATION_UNREAD_COUNT_QUERY_KEY';

/** 頂列鈴鐺的未讀數；新通知與已讀由推播讓它失效（`apis/resources.ts`）。 */
export const getNotificationUnreadCountQueryOptions = () =>
  queryOptions({
    queryKey: [PLATFORM_NOTIFICATION_UNREAD_COUNT_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchNotificationUnreadCountQuery({ params: undefined, signal }),
  });
