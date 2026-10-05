import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation } from '@tanstack/react-query';

import { getUpdateNotificationPreferencesMutationOptions } from '@/apis/notification/update-notification-preferences/mutation';
import { invalidateResources, Resource } from '@/apis/resources';

/** 開關自己的通知（偏好頁切換即儲存）。錯誤不在這裡吞掉，交給呼叫端。 */
export function useUpdateNotificationPreferencesMutation() {
  const toast = useToast();
  const { t } = useTranslation();
  return useMutation({
    ...getUpdateNotificationPreferencesMutationOptions(),
    onSuccess: (_, { params }) => {
      invalidateResources(
        [...new Set(params.changes.map((change) => change.type))].map((type) => ({
          resource: Resource.NOTIFICATION_PREFERENCE,
          kind: 'update' as const,
          id: type,
        })),
      );
      toast.success(t('notification.preference.saved'));
    },
  });
}
