import { IconButton } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Icon } from '@b2b-system/ui/Icon';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { RichTable } from '../components';
import type { FilterBarProps, RichTablePagination, TableSettingsConfig } from '../components';
import { useTranslation } from '../locales';
import type { AuditLogRowVM } from './types';

export interface AuditLogTableProps<
  TRow extends AuditLogRowVM,
  TFilters extends Record<string, unknown>,
> {
  items: TRow[];
  loading: boolean;
  /** 查詢失敗：沒有資料時以錯誤與重試取代表格，不落到「沒有資料」。 */
  error: unknown;
  onRetry: () => void;
  /** 目前展開明細的那一列；明細顯示在該列正下方 */
  expandedId: string | undefined;
  onToggleExpand: (id: string) => void;
  filters: FilterBarProps<TFilters>;
  pagination: RichTablePagination;
  /** 欄位順序與顯示存在這台裝置；可設定的欄位登記在 app 的 `features/audit-log/preference.ts`。 */
  settings: TableSettingsConfig;
  /**
   * 展開列的內容（app 的 `AuditLogDetail`）：backstage 展開時才取變更前後，
   * apps/platform 直接顯示列表帶的 metadata。
   */
  renderDetail: (row: TRow) => ReactNode;
}

/** 稽核紀錄的列表（兩個 app 共用）：時間、操作者、動作、資源、結果與展開明細。 */
export function AuditLogTable<
  TRow extends AuditLogRowVM,
  TFilters extends Record<string, unknown>,
>({
  items,
  loading,
  error,
  onRetry,
  expandedId,
  onToggleExpand,
  filters,
  pagination,
  settings,
  renderDetail,
}: AuditLogTableProps<TRow, TFilters>) {
  const { t } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<TRow>>>(
    () => [
      {
        id: 'occurredAt',
        header: t('auditLog.field.occurredAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.occurredAt),
      },
      {
        id: 'actorEmail',
        header: t('auditLog.field.actor'),
        enableSorting: false,
        cell: ({ row }) => row.original.actorEmail,
      },
      {
        id: 'action',
        header: t('auditLog.field.action'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <code
              className="font-mono text-xs"
              data-testid="audit-log-action"
              data-value={row.original.action}
            >
              {row.original.action}
            </code>
            {row.original.isHighRisk && <Chip tone="danger">{t('auditLog.highRisk')}</Chip>}
          </span>
        ),
      },
      {
        id: 'resource',
        header: t('auditLog.field.resource'),
        enableSorting: false,
        cell: ({ row }) => row.original.resourceLabel,
      },
      {
        id: 'result',
        header: t('auditLog.field.result'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.isSuccess ? (
            <Chip tone="success" data-testid="audit-log-result" data-value={row.original.result}>
              {t('auditLog.result.success')}
            </Chip>
          ) : (
            <Chip tone="danger" data-testid="audit-log-result" data-value={row.original.result}>
              {row.original.errorCode ?? t('auditLog.result.failure')}
            </Chip>
          ),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) => {
          const isExpanded = expandedId === row.original.id;
          const label = isExpanded ? t('auditLog.collapse') : t('auditLog.expand');
          return (
            <Tooltip content={label}>
              <IconButton
                size="sm"
                aria-label={label}
                aria-expanded={isExpanded}
                onClick={() => onToggleExpand(row.original.id)}
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
    [expandedId, onToggleExpand, t],
  );

  return (
    <RichTable
      data={items}
      columns={columns}
      loading={loading}
      error={error}
      onRetry={onRetry}
      getRowId={(row) => row.id}
      filters={filters}
      settings={settings}
      pagination={pagination}
      expandedRowIds={expandedId ? [expandedId] : undefined}
      renderExpandedRow={renderDetail}
      data-testid="audit-log-table"
    />
  );
}
