import { keepPreviousData, queryOptions } from '@tanstack/react-query';

import type { PlatformNotificationListParams } from '../types';
import { fetchNotificationListQuery } from './fetcher';

export const PLATFORM_NOTIFICATION_LIST_QUERY_KEY = 'PLATFORM_NOTIFICATION_LIST_QUERY_KEY';

const getNotificationListQueryKeys = (params: PlatformNotificationListParams) =>
  [
    PLATFORM_NOTIFICATION_LIST_QUERY_KEY,
    params.offset,
    params.limit,
    params.unread ? 'unread' : 'all',
  ] as const;

/**
 * 自己的通知（新的在前）。平台的通知量很小（只有佈建結果與換角色），用一般的 offset 分頁，
 * 不像租戶的通知用無限捲動與 keyset（docs/architecture/backend/15-notification.md §6.2）。
 */
export const getNotificationListQueryOptions = (params: PlatformNotificationListParams) =>
  queryOptions({
    queryKey: getNotificationListQueryKeys(params),
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => fetchNotificationListQuery({ params, signal }),
  });
