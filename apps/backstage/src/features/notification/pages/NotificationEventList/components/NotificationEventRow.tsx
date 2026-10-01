import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Switch } from '@/components/Switch';
import { useTranslation } from '@/core/locales';

import { NOTIFICATION_CHANNEL_LABEL_KEY } from '../../../constants';
import type { NotificationChannel, NotificationEventView } from '../../../types';

interface NotificationEventRowProps {
  event: NotificationEventView;
  canUpdate: boolean;
  current: (
    event: NotificationEventView,
    channel: NotificationChannel,
  ) => { enabled: boolean; isOverridden: boolean };
  onChange: (event: NotificationEventView, channel: NotificationChannel, enabled: boolean) => void;
  onReset: (event: NotificationEventView, channel: NotificationChannel) => void;
}

/** 一個事件：名稱、說明、誰會收到，以及每個管道一個開關。 */
export function NotificationEventRow({
  event,
  canUpdate,
  current,
  onChange,
  onReset,
}: NotificationEventRowProps) {
  const { t } = useTranslation();
  const name = event.nameKey ? t(event.nameKey) : event.type;

  return (
    <div
      className="flex flex-col gap-3 border-t border-[var(--color-border)] py-4 first:border-t-0 md:flex-row md:items-start md:justify-between"
      data-testid="notification-event-row"
      data-value={event.type}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-1 font-medium">
          {name}
          {event.mandatory && (
            <span
              className="inline-flex items-center gap-1 text-xs font-normal text-[var(--color-fg-muted)]"
              data-testid="notification-event-mandatory"
            >
              <Icon name="lock" size={14} />
              {t('notification.event.mandatory')}
            </span>
          )}
        </span>
        {event.descriptionKey && (
          <span className="text-sm text-[var(--color-fg-muted)]">{t(event.descriptionKey)}</span>
        )}
        {event.recipientsKey && (
          <span className="text-xs text-[var(--color-fg-muted)]">
            {t('notification.event.recipients', { recipients: t(event.recipientsKey) })}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-2">
        {event.channels.map(({ channel, defaultEnabled }) => {
          const { enabled, isOverridden } = current(event, channel);
          const channelLabel = t(NOTIFICATION_CHANNEL_LABEL_KEY[channel]);
          return (
            <div
              key={channel}
              className="flex flex-wrap items-center gap-2 text-sm"
              data-testid="notification-event-channel"
              data-value={channel}
            >
              <Switch
                checked={enabled}
                onCheckedChange={(next) => onChange(event, channel, next)}
                disabled={!canUpdate || event.mandatory}
                aria-label={t('notification.event.switchLabel', {
                  event: name,
                  channel: channelLabel,
                })}
                data-testid="notification-event-switch"
              />
              <span className="w-20">{channelLabel}</span>
              <span className="text-xs text-[var(--color-fg-muted)]">
                {t('notification.event.default', {
                  value: defaultEnabled
                    ? t('notification.event.state.on')
                    : t('notification.event.state.off'),
                })}
              </span>
              {isOverridden && (
                <span
                  className="rounded bg-[var(--color-fill-subtle)] px-1 text-xs text-[var(--color-fg-muted)]"
                  data-testid="notification-event-overridden"
                >
                  {t('notification.event.overridden')}
                </span>
              )}
              {isOverridden && canUpdate && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onReset(event, channel)}
                  data-testid="notification-event-reset"
                  data-value={channel}
                >
                  {t('notification.event.resetToDefault')}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
