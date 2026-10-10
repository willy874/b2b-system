import { Button } from '@b2b-system/ui/Button';
import { PageHeader } from '@b2b-system/ui/PageHeader';
import { useTranslation } from '@b2b-system/web-core/locales';
import { zonedDayBoundary } from '@b2b-system/web-shared/date';

import { NotificationOverviewTable } from './components/NotificationOverviewTable';
import { useNotificationOverview } from './useNotificationOverview';
import { useNotificationOverviewFilters } from './useNotificationOverviewFilters';

/** 通知總覽（`notification:read`；docs/architecture/backend/19-announcement.md §9.2 D1）：租戶內所有人的站內通知。 */
export default function NotificationOverviewPage() {
  const { t } = useTranslation();
  const { search, filters, clearSource } = useNotificationOverviewFilters();
  const overview = useNotificationOverview({
    type: search.type,
    recipientId: search.recipientId,
    actorId: search.actorId,
    sourceId: search.sourceId,
    unread: search.unread,
    // 網址上的日期是使用者當地的日曆日：起日取當天 00:00、迄日取 23:59:59（與稽核日誌相同）
    from: search.from ? zonedDayBoundary(search.from, 'start') : undefined,
    to: search.to ? zonedDayBoundary(search.to, 'end') : undefined,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="notification-overview-page">
      <PageHeader
        title={t('notification.overview.title')}
        description={t('notification.overview.description')}
      />
      {search.sourceId && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-bg-muted)] px-3 py-2 text-sm"
          data-testid="notification-overview-source"
        >
          <span>{t('notification.overview.filter.source')}</span>
          <Button size="sm" variant="ghost" onClick={clearSource}>
            {t('notification.overview.filter.clearSource')}
          </Button>
        </div>
      )}
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
