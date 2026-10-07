import { Chip } from '@b2b-system/ui/Chip';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { RichTable } from '../components';
import type { FilterBarProps, RichTablePagination } from '../components';
import { useTranslation } from '../locales';
import { JobRowActions } from './JobRowActions';
import type { JobRowVM } from './types';

export interface JobTableProps<TRow extends JobRowVM, TFilters extends Record<string, unknown>> {
  items: TRow[];
  loading: boolean;
  /** 查詢失敗：沒有資料時以錯誤與重試取代表格，不落到「沒有資料」。 */
  error: unknown;
  /** 重新查詢列表 */
  onRetry: () => void;
  expandedId: string | undefined;
  onToggleExpand: (id: string) => void;
  filters: FilterBarProps<TFilters>;
  pagination: RichTablePagination;
  /** 展開列的內容：明細在展開當下才向 app 自己的端點取（app 的 `JobDetail`）。 */
  renderDetail: (row: TRow) => ReactNode;
  /** 重試一筆失敗的工作（app 的 retry mutation 的 `mutateAsync`）。 */
  onRetryJob: (id: string) => Promise<unknown>;
  /** 插在「工作」欄之後的欄位（例：apps/platform 的租戶欄）；要穩定的參照（`useMemo`）。 */
  extraColumns?: Array<TableColumnDef<TRow>>;
}

/** 背景工作的列表（兩個 app 共用）：建立時間、工作、狀態、重試次數、結束時間與列上的操作。 */
export function JobTable<TRow extends JobRowVM, TFilters extends Record<string, unknown>>({
  items,
  loading,
  error,
  onRetry,
  expandedId,
  onToggleExpand,
  filters,
  pagination,
  renderDetail,
  onRetryJob,
  extraColumns,
}: JobTableProps<TRow, TFilters>) {
  const { t } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<TRow>>>(
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
      ...(extraColumns ?? []),
      {
        id: 'state',
        header: t('job.field.state'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-col items-start gap-1">
            <Chip
              tone={row.original.stateTone}
              data-testid="job-state"
              data-value={row.original.state}
            >
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
            onRetry={onRetryJob}
          />
        ),
      },
    ],
    [expandedId, extraColumns, onRetryJob, onToggleExpand, t],
  );

  return (
    <RichTable
      data={items}
      columns={columns}
      loading={loading}
      error={error}
      onRetry={onRetry}
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
