import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Table } from '@/components/Table';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';

import type { AuditLogRowVM } from '../adapter';

interface AuditLogTableProps {
  items: AuditLogRowVM[];
  loading: boolean;
  /** 目前展開明細的那一列 */
  expandedId: string | undefined;
  onToggleExpand: (id: string) => void;
}

export function AuditLogTable({ items, loading, expandedId, onToggleExpand }: AuditLogTableProps) {
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
        id: 'expand',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onToggleExpand(row.original.id)}
            data-testid="audit-log-expand"
          >
            {expandedId === row.original.id ? t('auditLog.collapse') : t('auditLog.expand')}
          </Button>
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
      emptyTitle={t('common.empty')}
      data-testid="audit-log-table"
    />
  );
}
