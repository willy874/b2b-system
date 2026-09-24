import { Link } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import type { UserSortField } from '@/apis/user/types';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Tooltip } from '@/components/Tooltip';
import { RichTable } from '@/core/components';
import type { FilterBarProps, RichTablePagination, TableSettingsConfig } from '@/core/components';
import { useTranslation } from '@/core/locales';
import type { SortEntry } from '@/shared/constants';
import { formatDateTime } from '@/shared/date';

import { USER_STATUS_LABEL_KEY } from '../../../constants';
import {
  useUserResetPasswordMutation,
  useUserUnlockMutation,
} from '../../../hooks/useUserMutations';
import { useUserPermission } from '../../../hooks/useUserPermission';
import { USER_LIST_TABLE_ID } from '../../../preference';
import { USER_SORT_FIELDS, UserDetailRoute } from '../../../routes';
import type { UserSearchQuery } from '../../../routes';
import type { UserRowVM } from '../adapter';
import type { UserFilterValues } from '../useUserFilters';

const STATUS_TONE = {
  active: 'success',
  pending: 'warning',
  inactive: 'neutral',
  locked: 'danger',
} as const;

/** 欄位順序與顯示存在這台裝置（`core/store/tableColumnSettings`）；可設定的欄位登記在 `preference.ts`。 */
const USER_TABLE_SETTINGS: TableSettingsConfig = { tableId: USER_LIST_TABLE_ID };

interface UserTableProps {
  rows: UserRowVM[];
  loading: boolean;
  search: UserSearchQuery;
  /** 表頭點擊：回報點擊後完整的多欄排序。 */
  onSortingChange: (sort: Array<SortEntry<UserSortField>>) => void;
  onRowDoubleClick: (row: UserRowVM) => void;
  onDelete: (row: UserRowVM) => void;
  filters: FilterBarProps<UserFilterValues>;
  pagination: RichTablePagination;
}

export function UserTable({
  rows,
  loading,
  search,
  onSortingChange,
  onRowDoubleClick,
  onDelete,
  filters,
  pagination,
}: UserTableProps) {
  const { t } = useTranslation();
  const permission = useUserPermission();
  const unlockUser = useUserUnlockMutation();
  const resetPassword = useUserResetPasswordMutation();

  const columns = useMemo<Array<ColumnDef<UserRowVM, unknown>>>(
    () => [
      {
        id: 'displayName',
        header: t('user.field.displayName'),
        cell: ({ row }) => (
          <Link
            to={UserDetailRoute.to}
            params={{ userId: row.original.id }}
            search={search}
            className="font-medium text-[var(--color-brand)]"
            data-testid="user-name-link"
          >
            {row.original.displayName}
          </Link>
        ),
      },
      { id: 'email', header: t('user.field.email'), cell: ({ row }) => row.original.email },
      {
        id: 'status',
        header: t('user.field.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <Chip tone={STATUS_TONE[row.original.status]}>
            {t(USER_STATUS_LABEL_KEY[row.original.status])}
          </Chip>
        ),
      },
      {
        id: 'roles',
        header: t('user.field.roles'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.roles.length ? (
            <span className="flex flex-wrap gap-1">
              {row.original.roles.map((role) => (
                <Chip key={role.id} tone={role.isSystem ? 'brand' : 'neutral'}>
                  {role.name}
                </Chip>
              ))}
            </span>
          ) : (
            <span className="text-[var(--color-fg-muted)]">{t('common.none')}</span>
          ),
      },
      {
        id: 'lastLoginAt',
        header: t('user.field.lastLoginAt'),
        cell: ({ row }) => formatDateTime(row.original.lastLoginAt),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1">
            {permission.canUnlock && row.original.status === 'locked' && (
              <Button
                size="sm"
                onClick={() => void unlockUser.mutate({ params: { userId: row.original.id } })}
                data-testid="user-unlock-button"
              >
                {t('user.unlock.action')}
              </Button>
            )}
            {permission.canResetPassword && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void resetPassword.mutate({ params: { userId: row.original.id } })}
                data-testid="user-reset-password-button"
              >
                {t('user.resetPassword.action')}
              </Button>
            )}
            {permission.canDelete && (
              <Tooltip content={row.original.isSelf ? t('user.delete.selfProtected') : ''}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!row.original.canDelete}
                  onClick={() => onDelete(row.original)}
                  data-testid="user-delete-button"
                >
                  {t('common.delete')}
                </Button>
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [onDelete, permission, resetPassword, search, t, unlockUser],
  );

  return (
    <RichTable
      data={rows}
      columns={columns}
      loading={loading}
      getRowId={(row) => row.id}
      filters={filters}
      settings={USER_TABLE_SETTINGS}
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
      data-testid="user-table"
    />
  );
}

function isSortField(value: string): value is UserSortField {
  return (USER_SORT_FIELDS as readonly string[]).includes(value);
}
