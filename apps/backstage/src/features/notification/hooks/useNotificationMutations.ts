import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getDeleteNotificationMutationOptions } from '@/apis/notification/delete-notification/mutation';
import { getMarkAllNotificationsReadMutationOptions } from '@/apis/notification/mark-all-notifications-read/mutation';
import { getMarkNotificationReadMutationOptions } from '@/apis/notification/mark-notification-read/mutation';
import { invalidateResources, Resource } from '@/apis/resources';

/** 標為已讀：列表與未讀數都要更新。其他裝置與分頁由伺服器推 `notification update`（發起的分頁略過）。 */
export function useMarkNotificationReadMutation() {
  return useMutation({
    ...getMarkNotificationReadMutationOptions(),
    onSuccess: (notification) => {
      invalidateResources([
        { resource: Resource.NOTIFICATION, kind: 'update', id: notification.id },
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
      invalidateResources([{ resource: Resource.NOTIFICATION, kind: 'update' }]);
      toast.success(t('notification.markAllRead.success', { count: result.updated }));
    },
  });
}

/** 刪除自己的一則：列表與未讀數都要更新。其他裝置與分頁由伺服器推 `notification delete`。 */
export function useDeleteNotificationMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getDeleteNotificationMutationOptions(),
    onSuccess: (_result, { params }) => {
      invalidateResources([
        { resource: Resource.NOTIFICATION, kind: 'delete', id: params.notificationId },
      ]);
      toast.success(t('notification.delete.success'));
    },
  });
}
