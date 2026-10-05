import { useErrorToast } from '@b2b-system/web-core/errors';
import { useCallback } from 'react';

import type { NotificationVM } from '../adapter';
import { useMarkNotificationReadMutation } from './useNotificationMutations';

/**
 * 點一則通知：未讀的先標為已讀（不等回應，換頁照常進行），換頁由連結本身（`<Link>`）處理。
 * 標為已讀失敗只提示，不擋換頁——下次打開鈴鐺它仍是未讀。
 */
export function useOpenNotification(): (notification: NotificationVM) => void {
  const { mutate } = useMarkNotificationReadMutation();
  const showError = useErrorToast();
  return useCallback(
    (notification) => {
      if (notification.isRead) return;
      mutate({ params: { notificationId: notification.id } }, { onError: showError });
    },
    [mutate, showError],
  );
}
