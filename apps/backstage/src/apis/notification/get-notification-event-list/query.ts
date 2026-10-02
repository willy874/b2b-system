import { queryOptions } from '@tanstack/react-query';

import { fetchNotificationEventListQuery } from './fetcher';

export const NOTIFICATION_EVENT_LIST_QUERY_KEY = 'NOTIFICATION_EVENT_LIST_QUERY_KEY';

/** 事件目錄與租戶的政策（`system:read`；docs/architecture/backend/16-notification-event.md §9.2 D9）；數量少，不分頁。 */
export const getNotificationEventListQueryOptions = () =>
  queryOptions({
    queryKey: [NOTIFICATION_EVENT_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchNotificationEventListQuery({ params: undefined, signal }),
  });
