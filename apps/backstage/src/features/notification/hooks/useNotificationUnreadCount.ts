import { useQuery } from '@tanstack/react-query';

import { getNotificationUnreadCountQueryOptions } from '@/apis/notification/get-notification-unread-count/query';
import { useHasSession } from '@/core/auth';
import { RealtimeStatus, useRealtimeStatus } from '@/core/realtime';

/** 推播斷線（或沒有推播）時多久重抓一次未讀數。 */
const POLL_INTERVAL_MS = 60_000;

/**
 * 頂列鈴鐺的未讀數。只從伺服器取得（docs/architecture/frontend/09-state-and-storage.md §4.2）；
 * 新通知與已讀由推播讓它失效，推播不可用時退回每分鐘重抓一次（ADR-0026 D8、D12）。
 */
export function useNotificationUnreadCount(): number {
  const hasSession = useHasSession();
  const realtime = useRealtimeStatus();
  const { data } = useQuery({
    ...getNotificationUnreadCountQueryOptions(),
    enabled: hasSession,
    refetchInterval: realtime === RealtimeStatus.CONNECTED ? false : POLL_INTERVAL_MS,
  });
  return data?.count ?? 0;
}
