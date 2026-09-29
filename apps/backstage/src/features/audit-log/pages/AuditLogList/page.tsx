import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { getAuditLogListQueryOptions } from '@/apis/audit-log/get-audit-log-list/query';
import { useTranslation } from '@/core/locales';

import { AUDIT_LOG_MAX_RANGE_DAYS } from '../../constants';
import { toAuditLogRowVM } from './adapter';
import { AuditLogTable } from './components/AuditLogTable';
import { useAuditLogFilters } from './useAuditLogFilters';
import { useAuditLogSearchFilter } from './useAuditLogSearchFilter';

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

  const { data, isPending } = useQuery(
    getAuditLogListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        action: search.action,
        resourceType: search.resourceType,
        result: search.result,
        // 網址上的日期是使用者當地的日曆日：起日取當天 00:00、迄日取 23:59:59
        from: search.from ? new Date(`${search.from}T00:00:00`).toISOString() : undefined,
        to: search.to ? new Date(`${search.to}T23:59:59`).toISOString() : undefined,
      },
    }),
  );

  const rows = useMemo(() => (data?.items ?? []).map(toAuditLogRowVM), [data]);

  return (
    <div className="flex flex-col gap-4" data-testid="audit-log-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('auditLog.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('auditLog.description', { days: AUDIT_LOG_MAX_RANGE_DAYS })}
        </p>
      </header>

      <AuditLogTable
        items={rows}
        loading={isPending}
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
