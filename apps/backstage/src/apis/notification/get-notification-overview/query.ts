import { infiniteQueryOptions, keepPreviousData } from '@tanstack/react-query';

import type { NotificationOverviewPage } from '@/shared/api-sdk';

import type { NotificationOverviewFilters } from '../types';
import { fetchNotificationOverviewQuery } from './fetcher';

export const NOTIFICATION_OVERVIEW_QUERY_KEY = 'NOTIFICATION_OVERVIEW_QUERY_KEY';

const getNotificationOverviewQueryKeys = (filters: NotificationOverviewFilters, limit: number) =>
  [
    NOTIFICATION_OVERVIEW_QUERY_KEY,
    limit,
    filters.type ?? '',
    filters.recipientId ?? '',
    filters.unread ?? false,
    filters.from ?? '',
    filters.to ?? '',
  ] as const;

/**
 * 通知總覽：租戶內所有人的通知，以 keyset 游標（`nextCursor`）接續下一頁
 * （與自己的通知相同的理由：新的通知不斷插在最前面，offset 會重複；docs/architecture/backend/19-announcement.md §9.2 D1）。
 */
export const getNotificationOverviewQueryOptions = (params: {
  filters: NotificationOverviewFilters;
  limit: number;
}) =>
  infiniteQueryOptions({
    queryKey: getNotificationOverviewQueryKeys(params.filters, params.limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: NotificationOverviewPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData, // 換篩選時不閃空白
    queryFn: ({ signal, pageParam }) =>
      fetchNotificationOverviewQuery({
        params: { ...params.filters, limit: params.limit, cursor: pageParam },
        signal,
      }),
  });
