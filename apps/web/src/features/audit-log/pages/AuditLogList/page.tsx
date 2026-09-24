import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { getAuditLogListQueryOptions } from '@/apis/audit-log/get-audit-log-list/query';
import { useTranslation } from '@/core/locales';

import { toAuditLogRowVM } from './adapter';
import { AuditLogDetail } from './components/AuditLogDetail';
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
        from: search.from ? new Date(search.from).toISOString() : undefined,
        to: search.to ? new Date(`${search.to}T23:59:59`).toISOString() : undefined,
      },
    }),
  );

  const rows = useMemo(() => (data?.items ?? []).map(toAuditLogRowVM), [data]);
  const detail = rows.find((row) => row.id === expanded);

  return (
    <div className="flex flex-col gap-4" data-testid="audit-log-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('auditLog.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('auditLog.description')}</p>
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

      {detail && <AuditLogDetail log={detail} />}
    </div>
  );
}
