import { Link } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import type { RoleSortField } from '@/apis/role/types';
import { IconButton } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { TextEllipsis } from '@/components/Ellipsis';
import { Icon } from '@/components/Icon';
import { Tooltip } from '@/components/Tooltip';
import { RichTable } from '@/core/components';
import type {
  FilterBarProps,
  RichTableBatch,
  RichTablePagination,
  TableSettingsConfig,
} from '@/core/components';
import { useTranslation } from '@/core/locales';
import type { SortEntry } from '@/shared/constants';
import { formatDateTime } from '@/shared/date';

import { useRolePermission } from '../../../hooks/useRolePermission';
import { ROLE_LIST_TABLE_ID } from '../../../preference';
import { ROLE_SORT_FIELDS, RoleDetailRoute } from '../../../routes';
import type { RoleSearchQuery } from '../../../routes';
import type { RoleRowVM } from '../adapter';
import type { RoleFilterValues } from '../useRoleFilters';

/** 欄位順序與顯示存在這台裝置（`core/store/tableColumnSettings`）；可設定的欄位登記在 `preference.ts`。 */
const ROLE_TABLE_SETTINGS: TableSettingsConfig = { tableId: ROLE_LIST_TABLE_ID };

interface RoleTableProps {
  rows: RoleRowVM[];
  loading: boolean;
  search: RoleSearchQuery;
  /** 表頭點擊：回報點擊後完整的多欄排序。 */
  onSortingChange: (sort: Array<SortEntry<RoleSortField>>) => void;
  onRowDoubleClick: (row: RoleRowVM) => void;
  onDelete: (row: RoleRowVM) => void;
  filters: FilterBarProps<RoleFilterValues>;
  batch: RichTableBatch<RoleRowVM>;
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
  batch,
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
        // 描述可能很長：限制寬度、放不下以省略號結尾，滑過顯示全文（不讓整張表被撐寬）
        cell: ({ row }) => (
          <TextEllipsis className="max-w-60">{row.original.description}</TextEllipsis>
        ),
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
        cell: ({ row }) => row.original.permissionCount,
      },
      {
        id: 'userCount',
        header: t('role.field.userCount'),
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
            {/* 有權限但當下狀態不允許 → disable ＋ tooltip 改成說明原因 */}
            {permission.canDelete && (
              <Tooltip
                content={
                  row.original.isSystem ? t('role.delete.systemProtected') : t('common.delete')
                }
              >
                <IconButton
                  size="sm"
                  aria-label={t('common.delete')}
                  disabled={!row.original.canDelete}
                  onClick={() => onDelete(row.original)}
                  data-testid="role-delete-button"
                >
                  <Icon name="trash" size={16} />
                </IconButton>
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
      getRowId={getRowId}
      filters={filters}
      batch={batch}
      settings={ROLE_TABLE_SETTINGS}
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
      data-testid="role-table"
    />
  );
}

const getRowId = (row: RoleRowVM) => row.id;

function isSortField(value: string): value is RoleSortField {
  return (ROLE_SORT_FIELDS as readonly string[]).includes(value);
}
