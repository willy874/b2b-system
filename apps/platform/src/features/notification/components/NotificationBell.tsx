import { Button, IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Link } from '@b2b-system/ui/Link';
import { Popover } from '@b2b-system/ui/Popover';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { NotificationDetailDialog } from '@b2b-system/web-core/notification';
import type { NotificationContent } from '@b2b-system/web-core/notification';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { getNotificationListQueryOptions } from '@/apis/platform-notification/get-notification-list/query';

import { toNotificationVM } from '../adapter';
import { NOTIFICATION_BADGE_MAX, NOTIFICATION_PANEL_LIMIT } from '../constants';
import { useDeleteNotification } from '../hooks/useDeleteNotification';
import { useNotificationLocale } from '../hooks/useNotificationLocale';
import { useMarkAllNotificationsReadMutation } from '../hooks/useNotificationMutations';
import { useNotificationUnreadCount } from '../hooks/useNotificationUnreadCount';
import { DEFAULT_NOTIFICATION_SEARCH, NotificationListRoute } from '../routes';
import { NotificationList } from './NotificationList';

/**
 * 頂列的通知工具（同 backstage 的 `NotificationBell`）：徽章是未讀數，點開是最近的通知與「全部已讀」。
 * 點一則先關 Popover 再開詳細內容的對話框。
 * 未讀數與列表只來自 query；新通知經推播讓兩者失效（docs/architecture/backend/15-notification.md §6.2）。
 */
export function NotificationBell() {
  const { t } = useTranslation();
  useNotificationLocale();
  const count = useNotificationUnreadCount();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<NotificationContent>();
  const deleteNotification = useDeleteNotification();
  const markAllRead = useMarkAllNotificationsReadMutation();
  const showError = useErrorToast();
  const list = useQuery({
    ...getNotificationListQueryOptions({ offset: 0, limit: NOTIFICATION_PANEL_LIMIT }),
    enabled: open,
  });
  const items = useMemo(() => (list.data?.items ?? []).map(toNotificationVM), [list.data]);

  return (
    <>
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
          <div className="flex items-baseline gap-2">
            <h2 className="m-0 text-sm font-semibold">{t('notification.title')}</h2>
            {count > 0 && (
              <span className="text-xs text-[var(--color-fg-muted)]">
                {t('notification.unreadCount', { count })}
              </span>
            )}
          </div>
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
          items={items}
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          unreadOnly={false}
          onOpenDetail={(content) => {
            setOpen(false);
            setDetail(content);
          }}
          onNavigate={() => setOpen(false)}
          className="-mx-4 max-h-[60vh]"
          data-testid="notification-panel-list"
        />
        <div className="flex justify-end border-t border-[var(--color-border)] pt-2">
          <Link
            render={
              <RouterLink to={NotificationListRoute.to} search={DEFAULT_NOTIFICATION_SEARCH} />
            }
            onClick={() => setOpen(false)}
            className="text-sm"
            data-testid="notification-view-all"
          >
            {t('notification.viewAll')}
          </Link>
        </div>
      </Popover>
      <NotificationDetailDialog
        notification={detail}
        onClose={() => setDetail(undefined)}
        onDelete={(notification) => deleteNotification(notification.id)}
      />
    </>
  );
}
