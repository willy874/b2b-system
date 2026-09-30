import { Button } from '@/components/Button';
import { Tabs } from '@/components/Tabs';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { NotificationList } from '../../components/NotificationList';
import { useMarkAllNotificationsReadMutation } from '../../hooks/useNotificationMutations';
import { useNotificationUnreadCount } from '../../hooks/useNotificationUnreadCount';
import { NOTIFICATION_FILTERS, NotificationListRoute } from '../../routes';
import type { NotificationSearchQuery } from '../../routes';

const FILTER_LABEL_KEY = {
  all: 'notification.filter.all',
  unread: 'notification.filter.unread',
} as const satisfies Record<NotificationSearchQuery['filter'], string>;

function isFilter(value: string): value is NotificationSearchQuery['filter'] {
  return (NOTIFICATION_FILTERS as readonly string[]).includes(value);
}

/** 自己的通知（docs/architecture/frontend/15-notification.md §4）：全部／未讀兩個分頁、全部已讀。只需要登入。 */
export default function NotificationListPage() {
  const { t } = useTranslation();
  const { filter } = NotificationListRoute.useSearch();
  const navigate = NotificationListRoute.useNavigate();
  const count = useNotificationUnreadCount();
  const markAllRead = useMarkAllNotificationsReadMutation();
  const showError = useErrorToast();

  return (
    <div className="flex flex-col gap-4" data-testid="notification-list-page">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('notification.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {t('notification.description')}
          </p>
        </div>
        <Button
          disabled={count === 0}
          loading={markAllRead.isPending}
          onClick={() => markAllRead.mutate({ params: undefined }, { onError: showError })}
          data-testid="notification-page-mark-all-read"
        >
          {t('notification.markAllRead.action')}
        </Button>
      </header>
      <Tabs
        value={filter}
        onValueChange={(value) => {
          if (isFilter(value)) void navigate({ search: { filter: value } });
        }}
        tabs={NOTIFICATION_FILTERS.map((value) => ({ value, label: t(FILTER_LABEL_KEY[value]) }))}
        data-testid="notification-filter"
      >
        <NotificationList
          filter={filter}
          className="mt-2 h-[calc(100vh-16rem)] min-h-64 rounded-[var(--radius-md)] border border-[var(--color-border)]"
          data-testid="notification-page-list"
        />
      </Tabs>
    </div>
  );
}
