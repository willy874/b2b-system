import { Button, IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Link } from '@b2b-system/ui/Link';
import { Popover } from '@b2b-system/ui/Popover';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { Link as RouterLink } from '@tanstack/react-router';
import { useState } from 'react';

import { NOTIFICATION_BADGE_MAX } from '../constants';
import { useNotificationLocale } from '../hooks/useNotificationLocale';
import { useMarkAllNotificationsReadMutation } from '../hooks/useNotificationMutations';
import { useNotificationUnreadCount } from '../hooks/useNotificationUnreadCount';
import { NotificationListRoute } from '../routes/pages';
import { NotificationList } from './NotificationList';

/**
 * 頂列的通知工具（`registerHeaderTool`，docs/architecture/backend/15-notification.md §12.2 D12）：徽章是未讀數，點開是最近的通知與「全部已讀」。
 * 未讀數與列表只來自 query，不存 localStorage；新通知經推播讓兩者失效。
 */
export function NotificationBell() {
  const { t } = useTranslation();
  useNotificationLocale();
  const count = useNotificationUnreadCount();
  const [open, setOpen] = useState(false);
  const markAllRead = useMarkAllNotificationsReadMutation();
  const showError = useErrorToast();

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[24rem] max-w-[min(24rem,calc(100vw-2rem))]"
      data-testid="notification-panel"
      trigger={
        <IconButton
          aria-label={
            count > 0 ? t('notification.triggerUnread', { count }) : t('notification.trigger')
          }
          className="relative"
          data-testid="notification-bell"
        >
          <Icon name="bell" size={16} />
          {/* 數量已含在 aria-label，徽章只給視覺 */}
          {count > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-brand)] px-1 text-[0.625rem] font-semibold leading-none text-[var(--color-brand-fg)]"
              data-testid="notification-unread-count"
              data-value={count}
            >
              {count > NOTIFICATION_BADGE_MAX ? `${NOTIFICATION_BADGE_MAX}+` : count}
            </span>
          )}
        </IconButton>
      }
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <h2 className="m-0 text-sm font-semibold">{t('notification.title')}</h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={count === 0}
          loading={markAllRead.isPending}
          onClick={() => markAllRead.mutate({ params: undefined }, { onError: showError })}
          data-testid="notification-mark-all-read"
        >
          {t('notification.markAllRead.action')}
        </Button>
      </div>
      <NotificationList
        filter="all"
        enabled={open}
        onNavigate={() => setOpen(false)}
        className="-mx-4 max-h-[60vh]"
        data-testid="notification-panel-list"
      />
      <div className="flex justify-end border-t border-[var(--color-border)] pt-2">
        <Link
          render={<RouterLink to={NotificationListRoute.to} />}
          onClick={() => setOpen(false)}
          className="text-sm"
          data-testid="notification-view-all"
        >
          {t('notification.viewAll')}
        </Link>
      </div>
    </Popover>
  );
}
