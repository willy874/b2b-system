import { IconButton } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { TextEllipsis } from '@b2b-system/ui/Ellipsis';
import { Icon } from '@b2b-system/ui/Icon';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { RichTable } from '@b2b-system/web-core/components';
import type { RichTablePagination, TableSearchProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import type { SortEntry } from '@b2b-system/web-shared/constants';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import type { ServiceAccountSortField } from '@/apis/service-account/types';

import { SERVICE_ACCOUNT_STATUS_LABEL_KEY, SERVICE_ACCOUNT_STATUS_TONE } from '../../../constants';
import { SERVICE_ACCOUNT_SORT_FIELDS, ServiceAccountDetailRoute } from '../../../routes';
import type { ServiceAccountSearchQuery } from '../../../routes';
import type { ServiceAccountRowVM } from '../adapter';

interface ServiceAccountTableProps {
  rows: ServiceAccountRowVM[];
  loading: boolean;
  search: ServiceAccountSearchQuery;
  canDelete: boolean;
  onSortingChange: (sort: Array<SortEntry<ServiceAccountSortField>>) => void;
  onRowDoubleClick: (row: ServiceAccountRowVM) => void;
  onDelete: (row: ServiceAccountRowVM) => void;
  searchBox: TableSearchProps;
  error: unknown;
  onRetry: () => void;
  pagination: RichTablePagination;
}

export function ServiceAccountTable({
  rows,
  loading,
  search,
  canDelete,
  onSortingChange,
  onRowDoubleClick,
  onDelete,
  searchBox,
  error,
  onRetry,
  pagination,
}: ServiceAccountTableProps) {
  const { t } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<ServiceAccountRowVM>>>(
    () => [
      {
        id: 'name',
        header: t('serviceAccount.field.name'),
        cell: ({ row }) => (
          <Link
            to={ServiceAccountDetailRoute.to}
            params={{ serviceAccountId: row.original.id }}
            search={search}
            className="font-medium text-[var(--color-brand)]"
            data-testid="service-account-name-link"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'status',
        header: t('serviceAccount.field.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <Chip tone={SERVICE_ACCOUNT_STATUS_TONE[row.original.status]}>
            {t(SERVICE_ACCOUNT_STATUS_LABEL_KEY[row.original.status])}
          </Chip>
        ),
      },
      {
        id: 'roles',
        header: t('serviceAccount.field.roles'),
        enableSorting: false,
        cell: ({ row }) => (
          <TextEllipsis className="max-w-60">{row.original.roleNames}</TextEllipsis>
        ),
      },
      {
        id: 'activeTokenCount',
        header: t('serviceAccount.field.activeTokenCount'),
        enableSorting: false,
        cell: ({ row }) => row.original.activeTokenCount,
      },
      {
        id: 'createdAt',
        header: t('serviceAccount.field.createdAt'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
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
                data-testid="service-account-delete-button"
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
      sorting={search.sort.map(({ sort, order }) => ({ sortBy: sort, sortOrder: order }))}
      onSortingChange={(sorting) =>
        onSortingChange(
          sorting.flatMap(({ sortBy, sortOrder }) =>
            isSortField(sortBy) ? [{ sort: sortBy, order: sortOrder }] : [],
          ),
        )
      }
      onRowDoubleClick={onRowDoubleClick}
      data-testid="service-account-table"
    />
  );
}

const getRowId = (row: ServiceAccountRowVM) => row.id;

function isSortField(value: string): value is ServiceAccountSortField {
  return (SERVICE_ACCOUNT_SORT_FIELDS as readonly string[]).includes(value);
}
