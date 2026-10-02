import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getNotificationOverviewQueryOptions } from '@/apis/notification/get-notification-overview/query';
import type { NotificationOverviewFilters } from '@/apis/notification/types';

import { NOTIFICATION_OVERVIEW_PAGE_SIZE } from '../../constants';
import { toNotificationOverviewRowVM } from './adapter';
import type { NotificationOverviewRowVM } from './adapter';

export interface NotificationOverviewState {
  rows: NotificationOverviewRowVM[];
  isPending: boolean;
  error: unknown;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

/** 租戶內所有人的通知（新的在前，keyset「載入更多」；docs/architecture/backend/19-announcement.md §9.2 D1）。 */
export function useNotificationOverview(
  filters: NotificationOverviewFilters,
): NotificationOverviewState {
  const query = useInfiniteQuery(
    getNotificationOverviewQueryOptions({ filters, limit: NOTIFICATION_OVERVIEW_PAGE_SIZE }),
  );
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = query;
  const rows = useMemo(
    () => (data?.pages ?? []).flatMap((page) => page.items.map(toNotificationOverviewRowVM)),
    [data],
  );
  return {
    rows,
    isPending: query.isPending,
    error: query.error,
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    loadMore: () => void fetchNextPage(),
    refetch: () => void refetch(),
  };
}
