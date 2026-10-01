import { useQuery } from '@tanstack/react-query';

import { getNotificationPreferenceListQueryOptions } from '@/apis/notification/get-notification-preference-list/query';
import { Skeleton } from '@/components/Skeleton';
import { Switch } from '@/components/Switch';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';
import type { NotificationChannel } from '@/shared/api-sdk';

import {
  NOTIFICATION_CHANNEL_LABEL_KEY,
  NOTIFICATION_EVENT_LABEL,
  NOTIFICATION_PREFERENCE_LOCK_LABEL_KEY,
} from '../constants';
import { useUpdateNotificationPreferencesMutation } from '../hooks/useUpdateNotificationPreferencesMutation';

/**
 * 偏好頁的「通知」分頁（docs/architecture/frontend/15-notification.md §10、ADR-0028 D15）：
 * 自己要收哪些通知。切換即儲存；租戶關掉或要求的管道顯示原因、不能切換。
 */
export function NotificationPreferenceSection() {
  const { t } = useTranslation();
  const { data, isPending } = useQuery(getNotificationPreferenceListQueryOptions());
  const update = useUpdateNotificationPreferencesMutation();
  const showError = useErrorToast();

  if (isPending) return <Skeleton className="h-24" />;

  const toggle = (type: string, channel: NotificationChannel, enabled: boolean) =>
    update.mutate({ params: { changes: [{ type, channel, enabled }] } }, { onError: showError });

  return (
    <div className="flex flex-col" data-testid="notification-preference">
      <p className="mt-0 mb-2 text-sm text-[var(--color-fg-muted)]">
        {t('notification.preference.description')}
      </p>
      {(data?.items ?? []).map((item) => {
        const label = NOTIFICATION_EVENT_LABEL[item.type];
        const name = label ? t(label.nameKey) : item.type;
        return (
          <div
            key={item.type}
            className="flex flex-col gap-2 border-t border-[var(--color-border)] py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between"
            data-testid="notification-preference-row"
            data-value={item.type}
          >
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-medium">{name}</span>
              {label && (
                <span className="text-sm text-[var(--color-fg-muted)]">
                  {t(label.descriptionKey)}
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              {item.channels.map((entry) => {
                const channelLabel = t(NOTIFICATION_CHANNEL_LABEL_KEY[entry.channel]);
                return (
                  <div
                    key={entry.channel}
                    className="flex flex-wrap items-center gap-2 text-sm"
                    data-testid="notification-preference-channel"
                    data-value={entry.channel}
                  >
                    <Switch
                      checked={entry.enabled}
                      onCheckedChange={(next) => toggle(item.type, entry.channel, next)}
                      disabled={entry.lock !== null || update.isPending}
                      aria-label={t('notification.event.switchLabel', {
                        event: name,
                        channel: channelLabel,
                      })}
                      data-testid="notification-preference-switch"
                    />
                    <span className="w-20">{channelLabel}</span>
                    {entry.lock && (
                      <span
                        className="text-xs text-[var(--color-fg-muted)]"
                        data-testid="notification-preference-lock"
                        data-value={entry.lock}
                      >
                        {t(NOTIFICATION_PREFERENCE_LOCK_LABEL_KEY[entry.lock])}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
