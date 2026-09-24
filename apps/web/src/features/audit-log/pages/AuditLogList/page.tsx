import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';

import { getAuditLogListQueryOptions } from '@/apis/audit-log/get-audit-log-list/query';
import { Pagination } from '@/components/Pagination';
import { useTranslation } from '@/core/locales';

import { toAuditLogRowVM } from './adapter';
import { AuditLogDetail } from './components/AuditLogDetail';
import { AuditLogFilter } from './components/AuditLogFilter';
import { AuditLogTable } from './components/AuditLogTable';
import { useAuditLogSearchFilter } from './useAuditLogSearchFilter';

export default function AuditLogListPage() {
  const { t } = useTranslation();
  const { search, setFilter, setPage } = useAuditLogSearchFilter();
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

      <AuditLogFilter search={search} onChange={setFilter} />

      <AuditLogTable
        items={rows}
        loading={isPending}
        expandedId={expanded}
        onToggleExpand={toggleExpand}
      />

      {detail && <AuditLogDetail log={detail} />}

      <Pagination
        offset={search.offset}
        limit={search.limit}
        total={data?.pagination.total ?? 0}
        pageSizeOptions={[25, 50, 100]}
        onChange={({ offset, limit }) => setPage(offset, limit)}
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          summary: ({ from, to, total }) => `${from}-${to} / ${total}`,
        }}
      />
    </div>
  );
}
