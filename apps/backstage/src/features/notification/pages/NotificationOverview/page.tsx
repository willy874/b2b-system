import { Button } from '@/components/Button';
import { useTranslation } from '@/core/locales';
import { zonedDayBoundary } from '@/shared/date';

import { NotificationOverviewTable } from './components/NotificationOverviewTable';
import { useNotificationOverview } from './useNotificationOverview';
import { useNotificationOverviewFilters } from './useNotificationOverviewFilters';

/** 通知總覽（`notification:read`；docs/architecture/backend/19-announcement.md §9.2 D1）：租戶內所有人的站內通知。 */
export default function NotificationOverviewPage() {
  const { t } = useTranslation();
  const { search, filters } = useNotificationOverviewFilters();
  const overview = useNotificationOverview({
    type: search.type,
    recipientId: search.recipientId,
    unread: search.unread,
    // 網址上的日期是使用者當地的日曆日：起日取當天 00:00、迄日取 23:59:59（與稽核日誌相同）
    from: search.from ? zonedDayBoundary(search.from, 'start') : undefined,
    to: search.to ? zonedDayBoundary(search.to, 'end') : undefined,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="notification-overview-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('notification.overview.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('notification.overview.description')}
        </p>
      </header>
      <NotificationOverviewTable
        rows={overview.rows}
        loading={overview.isPending}
        error={overview.error}
        onRetry={overview.refetch}
        filters={filters}
      />
      {overview.hasMore && (
        <div className="flex justify-center">
          <Button
            loading={overview.isLoadingMore}
            onClick={overview.loadMore}
            data-testid="notification-overview-load-more"
          >
            {t('notification.overview.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
