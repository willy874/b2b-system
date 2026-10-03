import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getNotificationListQueryOptions } from '@/apis/platform-notification/get-notification-list/query';
import { Button } from '@/components/Button';
import { Pagination } from '@/components/Pagination';
import { Tabs } from '@/components/Tabs';
import { useErrorToast } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { toNotificationVM } from '../../adapter';
import { NotificationList } from '../../components/NotificationList';
import { NOTIFICATION_PAGE_SIZE_OPTIONS } from '../../constants';
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

/** 自己的通知（同 backstage 的通知頁）：全部／未讀兩個分頁、全部已讀。只需要登入。 */
export default function NotificationListPage() {
  const { t } = useTranslation();
  const search = NotificationListRoute.useSearch();
  const navigate = NotificationListRoute.useNavigate();
  const count = useNotificationUnreadCount();
  const markAllRead = useMarkAllNotificationsReadMutation();
  const showError = useErrorToast();
  const unreadOnly = search.filter === 'unread';
  const list = useQuery(
    getNotificationListQueryOptions({
      offset: search.offset,
      limit: search.limit,
      unread: unreadOnly,
    }),
  );
  const items = useMemo(() => (list.data?.items ?? []).map(toNotificationVM), [list.data]);

  return (
    <div className="flex max-w-3xl flex-col gap-4" data-testid="notification-list-page">
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
        moreLabel={t('common.more')}
        value={search.filter}
        onValueChange={(value) => {
          if (isFilter(value)) void navigate({ search: { ...search, filter: value, offset: 0 } });
        }}
        tabs={NOTIFICATION_FILTERS.map((value) => ({ value, label: t(FILTER_LABEL_KEY[value]) }))}
        data-testid="notification-filter"
      >
        <NotificationList
          items={items}
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          unreadOnly={unreadOnly}
          className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-border)]"
          data-testid="notification-page-list"
        />
      </Tabs>
      <Pagination
        offset={search.offset}
        limit={search.limit}
        total={list.data?.pagination.total ?? 0}
        pageSizeOptions={NOTIFICATION_PAGE_SIZE_OPTIONS}
        onChange={({ offset, limit }) => void navigate({ search: { ...search, offset, limit } })}
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          summary: ({ from, to, total }) => t('common.paginationSummary', { from, to, total }),
        }}
        data-testid="notification-pagination"
      />
    </div>
  );
}
