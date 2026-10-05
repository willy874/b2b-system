import { Chip } from '@b2b-system/ui/Chip';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { RichTable } from '@b2b-system/web-core/components';
import type { FilterBarProps, RichTablePagination } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useMemo } from 'react';

import type { JobRowVM } from '../adapter';
import type { JobFilterValues } from '../useJobFilters';
import { JobDetail } from './JobDetail';
import { JobRowActions } from './JobRowActions';

/** 展開列的內容：明細在展開當下才向後端取（`JobDetail`）。 */
const renderDetail = (row: JobRowVM) => <JobDetail id={row.id} />;

interface JobTableProps {
  items: JobRowVM[];
  loading: boolean;
  expandedId: string | undefined;
  onToggleExpand: (id: string) => void;
  filters: FilterBarProps<JobFilterValues>;
  pagination: RichTablePagination;
}

export function JobTable({
  items,
  loading,
  expandedId,
  onToggleExpand,
  filters,
  pagination,
}: JobTableProps) {
  const { t } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<JobRowVM>>>(
    () => [
      {
        id: 'createdAt',
        header: t('job.field.createdAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: 'name',
        header: t('job.field.name'),
        enableSorting: false,
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
        id: 'state',
        header: t('job.field.state'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-col items-start gap-1">
            <Chip tone={row.original.stateTone} data-testid="job-state">
              {t(row.original.stateLabelKey)}
            </Chip>
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
        enableSorting: false,
        cell: ({ row }) => `${row.original.retryCount} / ${row.original.retryLimit}`,
      },
      {
        id: 'completedAt',
        header: t('job.field.completedAt'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.completedAt ? formatDateTime(row.original.completedAt) : '—',
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
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
    <RichTable
      data={items}
      columns={columns}
      loading={loading}
      getRowId={(row) => row.id}
      // 沒有批次操作：重試逐筆確認
      enableRowSelection={false}
      filters={filters}
      pagination={pagination}
      expandedRowIds={expandedId ? [expandedId] : undefined}
      renderExpandedRow={renderDetail}
      data-testid="job-table"
    />
  );
}
