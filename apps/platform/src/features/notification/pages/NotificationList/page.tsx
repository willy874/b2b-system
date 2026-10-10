import { Button } from '@b2b-system/ui/Button';
import { PageHeader } from '@b2b-system/ui/PageHeader';
import { Pagination } from '@b2b-system/ui/Pagination';
import { Tabs } from '@b2b-system/ui/Tabs';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { NotificationDetailDialog } from '@b2b-system/web-core/notification';
import type { NotificationContent } from '@b2b-system/web-core/notification';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getNotificationListQueryOptions } from '@/apis/platform-notification/get-notification-list/query';

import { toNotificationVM } from '../../adapter';
import { NotificationList } from '../../components/NotificationList';
import { NOTIFICATION_PAGE_SIZE_OPTIONS } from '../../constants';
import { useDeleteNotification } from '../../hooks/useDeleteNotification';
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

/** 自己的通知（同 backstage 的通知頁）：全部／未讀兩個分頁、勾選後批次標為已讀與刪除、全部已讀。只需要登入。 */
export default function NotificationListPage() {
  const { t } = useTranslation();
  const search = NotificationListRoute.useSearch();
  const navigate = NotificationListRoute.useNavigate();
  const count = useNotificationUnreadCount();
  const markAllRead = useMarkAllNotificationsReadMutation();
  const showError = useErrorToast();
  const [detail, setDetail] = useState<NotificationContent>();
  const deleteNotification = useDeleteNotification();
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
    <div className="flex flex-col gap-4" data-testid="notification-list-page">
      <PageHeader
        title={t('notification.title')}
        description={t('notification.description')}
        actions={
          <Button
            disabled={count === 0}
            loading={markAllRead.isPending}
            onClick={() => markAllRead.mutate({ params: undefined }, { onError: showError })}
            data-testid="notification-page-mark-all-read"
          >
            {t('notification.markAllRead.action')}
          </Button>
        }
      />
      <Tabs
        moreLabel={t('common.more')}
        value={search.filter}
        onValueChange={(value) => {
          if (isFilter(value)) void navigate({ search: { ...search, filter: value, offset: 0 } });
        }}
        tabs={NOTIFICATION_FILTERS.map((value) => ({ value, label: t(FILTER_LABEL_KEY[value]) }))}
        data-testid="notification-filter"
      >
        {/* 換分頁、換頁時重建：勾選只涵蓋這一頁 */}
        <NotificationList
          key={`${search.filter}:${search.offset}:${search.limit}`}
          selectable
          items={items}
          loading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          unreadOnly={unreadOnly}
          onOpenDetail={setDetail}
          // 與 backstage 相同撐滿到畫面底部，另扣掉下方分頁列的高度
          className="mt-2 h-[calc(100vh-19rem)] min-h-64 rounded-[var(--radius-md)] border border-[var(--color-border)]"
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
      <NotificationDetailDialog
        notification={detail}
        onClose={() => setDetail(undefined)}
        onDelete={(notification) => deleteNotification(notification.id)}
      />
    </div>
  );
}
