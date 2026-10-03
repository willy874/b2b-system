import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { getPlatformAuditLogListQueryOptions } from '@/apis/platform-audit-log/get-audit-log-list/query';
import { useTranslation } from '@/core/locales';
import { zonedDayBoundary } from '@/shared/date';

import { AUDIT_LOG_MAX_RANGE_DAYS } from '../../constants';
import { toAuditLogRowVM } from './adapter';
import { AuditLogTable } from './components/AuditLogTable';
import { useAuditLogFilters } from './useAuditLogFilters';
import { useAuditLogSearchFilter } from './useAuditLogSearchFilter';

/**
 * 平台稽核：依時間新到舊，伺服器分頁；篩選條件與分頁放在網址上（routes/model.ts）。
 * 沒選日期時交給後端的預設（最近 90 天）。
 */
export default function AuditLogListPage() {
  const { t } = useTranslation();
  const searchFilter = useAuditLogSearchFilter();
  const { search, setPage } = searchFilter;
  const filters = useAuditLogFilters(searchFilter);
  const [expanded, setExpanded] = useState<string>();
  const toggleExpand = useCallback(
    (id: string) => setExpanded((prev) => (prev === id ? undefined : id)),
    [],
  );

  const { data, error, isPending, refetch } = useQuery(
    getPlatformAuditLogListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        action: search.action,
        actorEmail: search.actorEmail,
        result: search.result,
        // 網址上的日期是使用者當地的日曆日：起日取當天 00:00、迄日取 23:59:59
        // 日界線用偏好的時區，與列表顯示的時間一致
        from: search.from ? zonedDayBoundary(search.from, 'start') : undefined,
        to: search.to ? zonedDayBoundary(search.to, 'end') : undefined,
      },
    }),
  );

  const rows = useMemo(() => (data?.items ?? []).map(toAuditLogRowVM), [data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="audit-log-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('auditLog.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('auditLog.description', { days: AUDIT_LOG_MAX_RANGE_DAYS })}
        </p>
      </header>

      <AuditLogTable
        items={rows}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        expandedId={expanded}
        onToggleExpand={toggleExpand}
        filters={filters}
        pagination={{
          offset: search.offset,
          limit: search.limit,
          total: data?.pagination.total ?? 0,
          pageSizeOptions: [25, 50, 100],
          onChange: ({ offset, limit }) => setPage(offset, limit),
        }}
      />
    </div>
  );
}
