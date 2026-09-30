import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getNotificationListQueryOptions } from '@/apis/notification/get-notification-list/query';
import type { NotificationFilter } from '@/apis/notification/types';
import { useHasSession } from '@/core/auth';
import { useRouteLinkResolver } from '@/core/route-link';

import { toNotificationVM } from '../adapter';
import type { NotificationVM } from '../adapter';
import { NOTIFICATION_PAGE_SIZE } from '../constants';

export interface NotificationListState {
  items: NotificationVM[];
  /** 第一頁還沒到。 */
  isPending: boolean;
  isError: boolean;
  error: unknown;
  hasMore: boolean;
  /** 正在載入下一頁。 */
  isLoadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

/**
 * 自己的通知（新的在前，keyset 無限捲動）。`enabled` 讓鈴鐺只在打開時才抓列表；
 * 連結依 route id 註冊表解析，feature 在執行期安裝或卸載時跟著變成可點或不可點。
 */
export function useNotificationList(
  filter: NotificationFilter,
  options: { enabled?: boolean } = {},
): NotificationListState {
  const hasSession = useHasSession();
  const resolveLink = useRouteLinkResolver();
  const query = useInfiniteQuery({
    ...getNotificationListQueryOptions({ filter, limit: NOTIFICATION_PAGE_SIZE }),
    enabled: hasSession && (options.enabled ?? true),
  });
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } = query;

  const items = useMemo(
    () =>
      (data?.pages ?? []).flatMap((page) =>
        page.items.map((item) => toNotificationVM(item, resolveLink)),
      ),
    [data, resolveLink],
  );

  return {
    items,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    hasMore: hasNextPage,
    isLoadingMore: isFetchingNextPage,
    loadMore: () => void fetchNextPage(),
    refetch: () => void refetch(),
  };
}
