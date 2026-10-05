import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getUpdateNotificationEventsMutationOptions } from '@/apis/notification/update-notification-events/mutation';
import { invalidateResources, Resource } from '@/apis/resources';

/** 開關事件的管道。錯誤不在這裡吞掉，交給呼叫端。 */
export function useUpdateNotificationEventsMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUpdateNotificationEventsMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources(
        [...new Set(params.changes.map((change) => change.type))].map((type) => ({
          resource: Resource.NOTIFICATION_POLICY,
          kind: 'update' as const,
          id: type,
        })),
      );
      toast.success(t('notification.event.save.success'));
    },
  });
}
