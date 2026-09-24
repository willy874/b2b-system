import { Link } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Tooltip } from '@/components/Tooltip';
import { RichTable } from '@/core/components';
import type { FilterBarProps, RichTablePagination, TableSettingsConfig } from '@/core/components';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';

import { useRolePermission } from '../../../hooks/useRolePermission';
import { ROLE_LIST_TABLE_ID } from '../../../preference';
import { RoleDetailRoute } from '../../../routes';
import type { RoleSearchQuery } from '../../../routes';
import type { RoleRowVM } from '../adapter';

/** 欄位順序與顯示存在這台裝置（`core/store/tableColumnSettings`）；可設定的欄位登記在 `preference.ts`。 */
const ROLE_TABLE_SETTINGS: TableSettingsConfig = { tableId: ROLE_LIST_TABLE_ID };

interface RoleTableProps {
  rows: RoleRowVM[];
  loading: boolean;
  search: RoleSearchQuery;
  onSortingChange: (
    sortBy: RoleSearchQuery['sortBy'],
    sortOrder: RoleSearchQuery['sortOrder'],
  ) => void;
  onRowDoubleClick: (row: RoleRowVM) => void;
  onDelete: (row: RoleRowVM) => void;
  filters: FilterBarProps;
  pagination: RichTablePagination;
}

export function RoleTable({
  rows,
  loading,
  search,
  onSortingChange,
  onRowDoubleClick,
  onDelete,
  filters,
  pagination,
}: RoleTableProps) {
  const { t } = useTranslation();
  const permission = useRolePermission();

  const columns = useMemo<Array<ColumnDef<RoleRowVM, unknown>>>(
    () => [
      {
        id: 'name',
        header: t('role.field.name'),
        cell: ({ row }) => (
          <Link
            to={RoleDetailRoute.to}
            params={{ roleId: row.original.id }}
            search={search}
            className="font-medium text-[var(--color-brand)]"
            data-testid="role-name-link"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'slug',
        header: t('role.field.slug'),
        cell: ({ row }) => <code className="font-mono text-xs">{row.original.slug}</code>,
      },
      {
        id: 'description',
        header: t('role.field.description'),
        cell: ({ row }) => row.original.description,
      },
      {
        id: 'isSystem',
        header: t('role.field.type'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.isSystem ? (
            <Chip tone="brand">{t('role.type.system')}</Chip>
          ) : (
            <Chip tone="neutral">{t('role.type.custom')}</Chip>
          ),
      },
      {
        id: 'permissionCount',
        header: t('role.field.permissionCount'),
        enableSorting: false,
        cell: ({ row }) => row.original.permissionCount,
      },
      {
        id: 'userCount',
        header: t('role.field.userCount'),
        enableSorting: false,
        cell: ({ row }) => row.original.userCount,
      },
      {
        id: 'createdAt',
        header: t('role.field.createdAt'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1">
            {/* 有權限但當下狀態不允許 → disable ＋ tooltip 說明 */}
            {permission.canDelete && (
              <Tooltip content={row.original.isSystem ? t('role.delete.systemProtected') : ''}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!row.original.canDelete}
                  onClick={() => onDelete(row.original)}
                  data-testid="role-delete-button"
                >
                  {t('common.delete')}
                </Button>
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [onDelete, permission, search, t],
  );

  return (
    <RichTable
      data={rows}
      columns={columns}
      loading={loading}
      getRowId={(row) => row.id}
      filters={filters}
      settings={ROLE_TABLE_SETTINGS}
      pagination={pagination}
      sorting={{ sortBy: search.sortBy, sortOrder: search.sortOrder }}
      onSortingChange={(sortBy, sortOrder) =>
        onSortingChange(sortBy as RoleSearchQuery['sortBy'], sortOrder)
      }
      onRowDoubleClick={onRowDoubleClick}
      data-testid="role-table"
    />
  );
}
