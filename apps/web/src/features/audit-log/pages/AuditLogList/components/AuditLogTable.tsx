import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { IconButton } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Tooltip } from '@/components/Tooltip';
import { RichTable } from '@/core/components';
import type { FilterBarProps, RichTablePagination, TableSettingsConfig } from '@/core/components';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';

import { AUDIT_LOG_LIST_DEFAULT_HIDDEN, AUDIT_LOG_LIST_TABLE_ID } from '../../../preference';
import type { AuditLogRowVM } from '../adapter';
import type { AuditLogFilterValues } from '../useAuditLogFilters';
import { AuditLogDetail } from './AuditLogDetail';

/** 展開列的內容：明細在展開當下才向後端取（`AuditLogDetail`）。 */
const renderDetail = (row: AuditLogRowVM) => <AuditLogDetail id={row.id} />;

/** 欄位順序與顯示存在這台裝置（`core/store/tableColumnSettings`）；可設定的欄位登記在 `preference.ts`。 */
const AUDIT_LOG_TABLE_SETTINGS: TableSettingsConfig = {
  tableId: AUDIT_LOG_LIST_TABLE_ID,
  defaultHidden: AUDIT_LOG_LIST_DEFAULT_HIDDEN,
};

interface AuditLogTableProps {
  items: AuditLogRowVM[];
  loading: boolean;
  /** 目前展開明細的那一列；明細顯示在該列正下方 */
  expandedId: string | undefined;
  onToggleExpand: (id: string) => void;
  filters: FilterBarProps<AuditLogFilterValues>;
  pagination: RichTablePagination;
}

export function AuditLogTable({
  items,
  loading,
  expandedId,
  onToggleExpand,
  filters,
  pagination,
}: AuditLogTableProps) {
  const { t } = useTranslation();

  const columns = useMemo<Array<ColumnDef<AuditLogRowVM, unknown>>>(
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
            <code className="font-mono text-xs">{row.original.action}</code>
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
            <Chip tone="success">{t('auditLog.result.success')}</Chip>
          ) : (
            <Chip tone="danger">{row.original.errorCode ?? t('auditLog.result.failure')}</Chip>
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
      getRowId={(row) => row.id}
      filters={filters}
      settings={AUDIT_LOG_TABLE_SETTINGS}
      pagination={pagination}
      expandedRowIds={expandedId ? [expandedId] : undefined}
      renderExpandedRow={renderDetail}
      data-testid="audit-log-table"
    />
  );
}
