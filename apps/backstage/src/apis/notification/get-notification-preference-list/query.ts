import { queryOptions } from '@tanstack/react-query';

import { fetchNotificationPreferenceListQuery } from './fetcher';

export const NOTIFICATION_PREFERENCE_LIST_QUERY_KEY = 'NOTIFICATION_PREFERENCE_LIST_QUERY_KEY';

/** 自己的通知設定（只需要登入；docs/architecture/backend/16-notification-event.md §9.2 D15）；數量少，不分頁。 */
export const getNotificationPreferenceListQueryOptions = () =>
  queryOptions({
    queryKey: [NOTIFICATION_PREFERENCE_LIST_QUERY_KEY] as const,
    queryFn: ({ signal }) => fetchNotificationPreferenceListQuery({ params: undefined, signal }),
  });
