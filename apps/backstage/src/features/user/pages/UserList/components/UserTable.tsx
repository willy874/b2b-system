import { IconButton } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Icon } from '@b2b-system/ui/Icon';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Tooltip } from '@b2b-system/ui/Tooltip';
import { RichTable } from '@b2b-system/web-core/components';
import type {
  FilterBarProps,
  RichTableBatch,
  RichTablePagination,
  TableSearchProps,
  TableSettingsConfig,
} from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import type { SortEntry } from '@b2b-system/web-shared/constants';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import type { UserSortField } from '@/apis/user/types';
import { TagChips } from '@/core/components';

import { USER_STATUS_LABEL_KEY, USER_STATUS_TONE } from '../../../constants';
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
  /** 表格上方常駐的關鍵字搜尋。 */
  searchBox: TableSearchProps;
  /** 列表查詢失敗（顯示錯誤與重試，不落到「沒有資料」）。 */
  error: unknown;
  onRetry: () => void;
  batch: RichTableBatch<UserRowVM>;
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
  searchBox,
  error,
  onRetry,
  batch,
  pagination,
}: UserTableProps) {
  const { t } = useTranslation();
  const permission = useUserPermission();
  const unlockUser = useUserUnlockMutation();
  const resetPassword = useUserResetPasswordMutation();
  const confirm = useConfirm();

  const columns = useMemo<Array<TableColumnDef<UserRowVM>>>(
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
          <Chip tone={USER_STATUS_TONE[row.original.status]}>
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
        id: 'tags',
        header: t('user.field.tags'),
        enableSorting: false,
        cell: ({ row }) => (
          <TagChips
            tags={row.original.tags}
            max={3}
            empty={<span className="text-[var(--color-fg-muted)]">{t('common.none')}</span>}
          />
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
              <Tooltip content={t('user.unlock.action')}>
                <IconButton
                  size="sm"
                  aria-label={t('user.unlock.action')}
                  onClick={() => void unlockUser.mutate({ params: { userId: row.original.id } })}
                  data-testid="user-unlock-button"
                >
                  <Icon name="unlock" size={16} />
                </IconButton>
              </Tooltip>
            )}
            {permission.canResetPassword && (
              <Tooltip content={t('user.resetPassword.action')}>
                <IconButton
                  size="sm"
                  aria-label={t('user.resetPassword.action')}
                  // 會寄信並留下稽核紀錄：先確認；確認框送出期間不能重按，列上的按鈕也轉圈
                  loading={
                    resetPassword.isPending &&
                    resetPassword.variables?.params.userId === row.original.id
                  }
                  onClick={() =>
                    void confirm({
                      title: t('user.resetPassword.title'),
                      description: t('user.resetPassword.confirm', { email: row.original.email }),
                      confirmLabel: t('user.resetPassword.submit'),
                      tone: 'primary',
                      onConfirm: () =>
                        resetPassword.mutateAsync({ params: { userId: row.original.id } }),
                      'data-testid': 'user-reset-password-confirm',
                    })
                  }
                  data-testid="user-reset-password-button"
                >
                  <Icon name="key" size={16} />
                </IconButton>
              </Tooltip>
            )}
            {/* 有權限但當下狀態不允許 → disable ＋ tooltip 改成說明原因 */}
            {permission.canDelete && (
              <Tooltip
                content={row.original.isSelf ? t('user.delete.selfProtected') : t('common.delete')}
              >
                <IconButton
                  size="sm"
                  aria-label={t('common.delete')}
                  disabled={!row.original.canDelete}
                  onClick={() => onDelete(row.original)}
                  data-testid="user-delete-button"
                >
                  <Icon name="trash" size={16} />
                </IconButton>
              </Tooltip>
            )}
          </div>
        ),
      },
    ],
    [confirm, onDelete, permission, resetPassword, search, t, unlockUser],
  );

  return (
    <RichTable
      data={rows}
      columns={columns}
      loading={loading}
      getRowId={getRowId}
      filters={filters}
      search={searchBox}
      error={error}
      onRetry={onRetry}
      batch={batch}
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

const getRowId = (row: UserRowVM) => row.id;

function isSortField(value: string): value is UserSortField {
  return (USER_SORT_FIELDS as readonly string[]).includes(value);
}
