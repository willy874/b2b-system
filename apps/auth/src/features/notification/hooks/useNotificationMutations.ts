import { useMutation } from '@tanstack/react-query';

import { getMarkAllNotificationsReadMutationOptions } from '@/apis/platform-notification/mark-all-notifications-read/mutation';
import { getMarkNotificationReadMutationOptions } from '@/apis/platform-notification/mark-notification-read/mutation';
import { invalidateResources, Resource } from '@/apis/resources';
import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

/** 標為已讀：列表與未讀數都要更新。其他裝置與分頁由伺服器推 `platformNotification update`。 */
export function useMarkNotificationReadMutation() {
  return useMutation({
    ...getMarkNotificationReadMutationOptions(),
    onSuccess: (_result, { params }) => {
      invalidateResources([
        { resource: Resource.PLATFORM_NOTIFICATION, kind: 'update', id: params.notificationId },
      ]);
    },
  });
}

export function useMarkAllNotificationsReadMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getMarkAllNotificationsReadMutationOptions(),
    onSuccess: (result) => {
      invalidateResources([{ resource: Resource.PLATFORM_NOTIFICATION, kind: 'update' }]);
      toast.success(t('notification.markAllRead.success', { count: result.updated }));
    },
  });
}
