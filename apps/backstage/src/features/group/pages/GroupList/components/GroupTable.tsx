import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import type { GroupSortField } from '@/apis/group/types';
import { IconButton } from '@/components/Button';
import { TextEllipsis } from '@/components/Ellipsis';
import { Icon } from '@/components/Icon';
import type { TableColumnDef } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import { RichTable } from '@/core/components';
import type { RichTablePagination, TableSearchProps } from '@/core/components';
import { useTranslation } from '@/core/locales';
import type { SortEntry } from '@/shared/constants';
import { formatDateTime } from '@/shared/date';

import { GROUP_SORT_FIELDS, GroupDetailRoute } from '../../../routes';
import type { GroupSearchQuery } from '../../../routes';
import type { GroupRowVM } from '../adapter';

interface GroupTableProps {
  rows: GroupRowVM[];
  loading: boolean;
  search: GroupSearchQuery;
  canDelete: boolean;
  onSortingChange: (sort: Array<SortEntry<GroupSortField>>) => void;
  onRowDoubleClick: (row: GroupRowVM) => void;
  onDelete: (row: GroupRowVM) => void;
  searchBox: TableSearchProps;
  error: unknown;
  onRetry: () => void;
  pagination: RichTablePagination;
}

export function GroupTable({
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
}: GroupTableProps) {
  const { t } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<GroupRowVM>>>(
    () => [
      {
        id: 'name',
        header: t('group.field.name'),
        cell: ({ row }) => (
          <Link
            to={GroupDetailRoute.to}
            params={{ groupId: row.original.id }}
            search={search}
            className="font-medium text-[var(--color-brand)]"
            data-testid="group-name-link"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'description',
        header: t('group.field.description'),
        enableSorting: false,
        cell: ({ row }) => (
          <TextEllipsis className="max-w-60">{row.original.description}</TextEllipsis>
        ),
      },
      {
        id: 'memberCount',
        header: t('group.field.memberCount'),
        cell: ({ row }) => row.original.memberCount,
      },
      {
        id: 'roleCount',
        header: t('group.field.roleCount'),
        cell: ({ row }) => row.original.roleCount,
      },
      {
        id: 'createdAt',
        header: t('group.field.createdAt'),
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
                data-testid="group-delete-button"
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
      // 群組沒有批次操作：不提供勾選欄
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
      data-testid="group-table"
    />
  );
}

const getRowId = (row: GroupRowVM) => row.id;

function isSortField(value: string): value is GroupSortField {
  return (GROUP_SORT_FIELDS as readonly string[]).includes(value);
}
