import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import { getPlatformAuditLogListQueryOptions } from '@/apis/platform-audit-log/get-audit-log-list/query';
import { IconButton } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Pagination } from '@/components/Pagination';
import type { TableColumnDef } from '@/components/Table';
import { Table } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import { useTranslation } from '@/core/locales';
import type { PlatformAuditLog } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { AUDIT_LOG_MAX_RANGE_DAYS, AUDIT_LOG_PAGE_SIZE_OPTIONS } from '../../constants';
import { AuditLogListRoute } from '../../routes';
import type { AuditLogSearchQuery } from '../../routes';
import { AuditLogDetail } from './components/AuditLogDetail';
import { AuditLogFilterBar } from './components/AuditLogFilterBar';
import type { AuditLogFilterValues } from './components/AuditLogFilterBar';
import { AuditLogResult } from './components/AuditLogResult';

/** 展開列的內容：列表已帶 metadata，不需要再向後端取。 */
const renderDetail = (log: PlatformAuditLog) => <AuditLogDetail log={log} />;

/**
 * 平台稽核：依時間新到舊，伺服器分頁；篩選條件與分頁放在網址上（routes/model.ts）。
 * 時間範圍交給後端的預設（最近 90 天）。
 */
export default function AuditLogListPage() {
  const { t } = useTranslation();
  const search = AuditLogListRoute.useSearch();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string>();
  const toggleExpand = useCallback(
    (id: string) => setExpanded((prev) => (prev === id ? undefined : id)),
    [],
  );

  const { data, isPending } = useQuery(
    getPlatformAuditLogListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        action: search.action,
        actorEmail: search.actorEmail,
        result: search.result,
      },
    }),
  );

  const patch = (next: Partial<AuditLogSearchQuery>) =>
    void navigate({ to: AuditLogListRoute.to, search: { ...search, ...next } });
  // 三個條件一起覆寫（重設時全部是 undefined）；條件變了就回第一頁
  const applyFilters = ({ action, actorEmail, result }: AuditLogFilterValues) =>
    patch({ action, actorEmail, result, offset: 0 });
  const setPage = ({ offset, limit }: { offset: number; limit: number }) =>
    patch({ offset, limit });

  const columns = useMemo<Array<TableColumnDef<PlatformAuditLog>>>(
    () => [
      {
        id: 'occurredAt',
        header: t('auditLog.field.occurredAt'),
        cell: ({ row }) => formatDateTime(row.original.occurredAt),
      },
      {
        id: 'actorEmail',
        header: t('auditLog.field.actor'),
        cell: ({ row }) => row.original.actorEmail,
      },
      {
        id: 'action',
        header: t('auditLog.field.action'),
        cell: ({ row }) => (
          <code
            className="font-mono text-xs"
            data-testid="audit-log-action"
            data-value={row.original.action}
          >
            {row.original.action}
          </code>
        ),
      },
      {
        id: 'resource',
        header: t('auditLog.field.resource'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span>{row.original.resourceType}</span>
            {row.original.resourceId && (
              <code className="font-mono text-xs text-[var(--color-fg-muted)]">
                {row.original.resourceId}
              </code>
            )}
          </span>
        ),
      },
      {
        id: 'result',
        header: t('auditLog.field.result'),
        cell: ({ row }) => (
          <AuditLogResult result={row.original.result} errorCode={row.original.errorCode} />
        ),
      },
      {
        id: 'expand',
        header: '',
        cell: ({ row }) => {
          const isExpanded = expanded === row.original.id;
          const label = isExpanded ? t('auditLog.collapse') : t('auditLog.expand');
          return (
            <Tooltip content={label}>
              <IconButton
                size="sm"
                aria-label={label}
                aria-expanded={isExpanded}
                onClick={() => toggleExpand(row.original.id)}
                data-testid="audit-log-expand"
                data-value={row.original.id}
              >
                <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={16} />
              </IconButton>
            </Tooltip>
          );
        },
      },
    ],
    [expanded, toggleExpand, t],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="audit-log-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('auditLog.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('auditLog.description', { days: AUDIT_LOG_MAX_RANGE_DAYS })}
        </p>
      </header>

      <AuditLogFilterBar
        key={`${search.action ?? ''}\n${search.actorEmail ?? ''}`}
        search={search}
        onChange={applyFilters}
      />

      <Table
        data={data?.items ?? []}
        columns={columns}
        getRowId={(row) => row.id}
        loading={isPending}
        emptyTitle={t('auditLog.empty')}
        expandedRowIds={expanded ? [expanded] : undefined}
        renderExpandedRow={renderDetail}
        data-testid="audit-log-table"
      />

      <Pagination
        offset={search.offset}
        limit={search.limit}
        total={data?.pagination.total ?? 0}
        pageSizeOptions={AUDIT_LOG_PAGE_SIZE_OPTIONS}
        onChange={setPage}
        labels={{
          previous: t('auditLog.pagination.previous'),
          next: t('auditLog.pagination.next'),
          summary: ({ from, to, total }) => t('auditLog.pagination.summary', { from, to, total }),
        }}
        data-testid="audit-log-pagination"
      />
    </div>
  );
}
