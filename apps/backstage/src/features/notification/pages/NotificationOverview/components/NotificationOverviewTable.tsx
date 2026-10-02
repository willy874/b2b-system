import { useMemo } from 'react';

import { Chip } from '@/components/Chip';
import type { TableColumnDef } from '@/components/Table';
import { RichTable } from '@/core/components';
import type { FilterBarProps } from '@/core/components';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';

import { translateMessage } from '../../../adapter';
import type { NotificationOverviewRowVM } from '../adapter';
import type { NotificationOverviewFilterValues } from '../useNotificationOverviewFilters';

interface NotificationOverviewTableProps {
  rows: NotificationOverviewRowVM[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  filters: FilterBarProps<NotificationOverviewFilterValues>;
}

export function NotificationOverviewTable({
  rows,
  loading,
  error,
  onRetry,
  filters,
}: NotificationOverviewTableProps) {
  const { t, language } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<NotificationOverviewRowVM>>>(
    () => [
      {
        id: 'createdAt',
        header: t('notification.overview.field.createdAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: 'recipient',
        header: t('notification.overview.field.recipient'),
        enableSorting: false,
        cell: ({ row }) => row.original.recipientName,
      },
      {
        id: 'type',
        header: t('notification.overview.field.type'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.eventNameKey ? (
            t(row.original.eventNameKey)
          ) : (
            <code className="font-mono text-xs">{row.original.type}</code>
          ),
      },
      {
        id: 'message',
        header: t('notification.overview.field.message'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex flex-col gap-0.5">
            <span>{translateMessage(t, language, row.original.message)}</span>
            {row.original.details.map((detail) => (
              <span key={detail.key} className="text-xs text-[var(--color-fg-muted)]">
                {translateMessage(t, language, detail)}
              </span>
            ))}
          </span>
        ),
      },
      {
        id: 'actor',
        header: t('notification.overview.field.actor'),
        enableSorting: false,
        cell: ({ row }) => row.original.actorName ?? t('notification.actor.system'),
      },
      {
        id: 'readAt',
        header: t('notification.overview.field.readAt'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.readAt ? (
            formatDateTime(row.original.readAt)
          ) : (
            <Chip tone="brand">{t('notification.filter.unread')}</Chip>
          ),
      },
    ],
    [language, t],
  );

  return (
    <RichTable
      data={rows}
      columns={columns}
      loading={loading}
      error={error}
      onRetry={onRetry}
      getRowId={(row) => row.id}
      filters={filters}
      // 唯讀的總覽：沒有批次操作
      enableRowSelection={false}
      data-testid="notification-overview-table"
    />
  );
}
