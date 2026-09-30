import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { Table } from '@/components/Table';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';

import type { JobRowVM } from '../adapter';
import { JobDetail } from './JobDetail';
import { JobRowActions } from './JobRowActions';
import { JobStateLabel } from './JobStateLabel';

/** 展開列的內容：明細在展開當下才向後端取（`JobDetail`）。 */
const renderDetail = (row: JobRowVM) => <JobDetail id={row.id} />;

interface JobTableProps {
  items: JobRowVM[];
  loading: boolean;
  expandedId: string | undefined;
  onToggleExpand: (id: string) => void;
}

export function JobTable({ items, loading, expandedId, onToggleExpand }: JobTableProps) {
  const { t } = useTranslation();

  const columns = useMemo<Array<ColumnDef<JobRowVM, unknown>>>(
    () => [
      {
        id: 'createdAt',
        header: t('job.field.createdAt'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: 'name',
        header: t('job.field.name'),
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span>{row.original.labelKey ? t(row.original.labelKey) : row.original.name}</span>
            <code className="font-mono text-xs text-[var(--color-fg-muted)]">
              {row.original.id}
            </code>
          </span>
        ),
      },
      {
        id: 'tenant',
        header: t('job.field.tenant'),
        cell: ({ row }) => (
          <span data-testid="job-tenant" data-value={row.original.ownerValue}>
            {row.original.owner.kind === 'platform' ? (
              <span className="text-[var(--color-fg-muted)]">{t('job.tenant.platform')}</span>
            ) : (
              <code className="font-mono text-xs">{row.original.owner.label}</code>
            )}
          </span>
        ),
      },
      {
        id: 'state',
        header: t('job.field.state'),
        cell: ({ row }) => (
          <span className="flex flex-col items-start gap-1">
            <JobStateLabel row={row.original} />
            {row.original.scheduledAt && (
              <span className="text-xs text-[var(--color-fg-muted)]">
                {t('job.scheduledAt', { time: formatDateTime(row.original.scheduledAt) })}
              </span>
            )}
          </span>
        ),
      },
      {
        id: 'retries',
        header: t('job.field.retries'),
        cell: ({ row }) => `${row.original.retryCount} / ${row.original.retryLimit}`,
      },
      {
        id: 'completedAt',
        header: t('job.field.completedAt'),
        cell: ({ row }) =>
          row.original.completedAt ? formatDateTime(row.original.completedAt) : '—',
      },
      {
        id: 'actions',
        header: t('common.actions'),
        cell: ({ row }) => (
          <JobRowActions
            row={row.original}
            isExpanded={expandedId === row.original.id}
            onToggleExpand={onToggleExpand}
          />
        ),
      },
    ],
    [expandedId, onToggleExpand, t],
  );

  return (
    <Table
      data={items}
      columns={columns}
      loading={loading}
      getRowId={(row) => row.id}
      emptyTitle={t('job.empty')}
      expandedRowIds={expandedId ? [expandedId] : undefined}
      renderExpandedRow={renderDetail}
      data-testid="job-table"
    />
  );
}
