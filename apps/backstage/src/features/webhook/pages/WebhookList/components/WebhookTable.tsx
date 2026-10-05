import { IconButton } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { TextEllipsis } from '@b2b-system/ui/Ellipsis';
import { Icon } from '@b2b-system/ui/Icon';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { RichTable } from '@b2b-system/web-core/components';
import type { RichTablePagination, TableSearchProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { WEBHOOK_STATUS_LABEL_KEY, WEBHOOK_STATUS_TONE } from '../../../constants';
import { WebhookDetailRoute } from '../../../routes';
import type { WebhookSearchQuery } from '../../../routes';
import type { WebhookRowVM } from '../adapter';

interface WebhookTableProps {
  rows: WebhookRowVM[];
  loading: boolean;
  search: WebhookSearchQuery;
  canDelete: boolean;
  onRowDoubleClick: (row: WebhookRowVM) => void;
  onDelete: (row: WebhookRowVM) => void;
  searchBox: TableSearchProps;
  error: unknown;
  onRetry: () => void;
  pagination: RichTablePagination;
}

export function WebhookTable({
  rows,
  loading,
  search,
  canDelete,
  onRowDoubleClick,
  onDelete,
  searchBox,
  error,
  onRetry,
  pagination,
}: WebhookTableProps) {
  const { t } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<WebhookRowVM>>>(
    () => [
      {
        id: 'name',
        header: t('webhook.field.name'),
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={WebhookDetailRoute.to}
            params={{ webhookId: row.original.id }}
            search={search}
            className="font-medium text-[var(--color-brand)]"
            data-testid="webhook-name-link"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'url',
        header: t('webhook.field.urls'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-1">
            <TextEllipsis className="max-w-72">{row.original.url}</TextEllipsis>
            {row.original.moreUrls > 0 && (
              <Chip data-testid="webhook-more-urls" data-value={row.original.moreUrls}>
                {t('webhook.list.moreUrls', { count: row.original.moreUrls })}
              </Chip>
            )}
          </span>
        ),
      },
      {
        id: 'status',
        header: t('webhook.field.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <Chip tone={WEBHOOK_STATUS_TONE[row.original.status]} data-testid="webhook-status">
            {t(WEBHOOK_STATUS_LABEL_KEY[row.original.status])}
          </Chip>
        ),
      },
      {
        id: 'eventCount',
        header: t('webhook.field.eventCount'),
        enableSorting: false,
        cell: ({ row }) => row.original.eventCount,
      },
      {
        id: 'consecutiveFailures',
        header: t('webhook.field.consecutiveFailures'),
        enableSorting: false,
        cell: ({ row }) => row.original.consecutiveFailures,
      },
      {
        id: 'lastDeliveryAt',
        header: t('webhook.field.lastDeliveryAt'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.lastDeliveryAt ? formatDateTime(row.original.lastDeliveryAt) : '-',
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) =>
          canDelete && (
            <Tooltip content={t('common.delete')}>
              <IconButton
                size="sm"
                aria-label={t('common.delete')}
                onClick={() => onDelete(row.original)}
                data-testid="webhook-delete-button"
              >
                <Icon name="trash" size={16} />
              </IconButton>
            </Tooltip>
          ),
      },
    ],
    [canDelete, onDelete, search, t],
  );

  return (
    <RichTable
      data={rows}
      columns={columns}
      loading={loading}
      getRowId={getRowId}
      enableRowSelection={false}
      search={searchBox}
      error={error}
      onRetry={onRetry}
      pagination={pagination}
      onRowDoubleClick={onRowDoubleClick}
      data-testid="webhook-table"
    />
  );
}

const getRowId = (row: WebhookRowVM) => row.id;
