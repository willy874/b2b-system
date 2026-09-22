import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getUserListQueryOptions } from '@/apis/user/get-user-list/query';
import { AlertDialog } from '@/components/AlertDialog';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Input } from '@/components/Input';
import { Pagination } from '@/components/Pagination';
import { Select } from '@/components/Select';
import { Table } from '@/components/Table';
import { Tooltip } from '@/components/Tooltip';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';

import {
  useUserDeleteMutation,
  useUserResetPasswordMutation,
  useUserUnlockMutation,
} from '../../hooks/useUserMutations';
import { useUserPermission } from '../../hooks/useUserPermission';
import { UserCreateRoute, UserDetailRoute, UserListRoute } from '../../routes';
import type { UserSearchQuery } from '../../routes';
import { toUserRowVM } from './adapter';
import type { UserRowVM } from './adapter';

const STATUS_TONE = {
  active: 'success',
  pending: 'warning',
  inactive: 'neutral',
  locked: 'danger',
} as const;

export default function UserListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useUserPermission();
  const search = UserListRoute.useSearch();
  const [keywordDraft, setKeywordDraft] = useState(search.keyword ?? '');
  const [pendingDelete, setPendingDelete] = useState<UserRowVM>();

  const profile = useQuery(getAuthProfileQueryOptions());
  const deleteUser = useUserDeleteMutation();
  const unlockUser = useUserUnlockMutation();
  const resetPassword = useUserResetPasswordMutation();

  const patch = (next: Partial<UserSearchQuery>) =>
    void navigate({ to: UserListRoute.to, search: { ...search, ...next } });

  const { data, isPending } = useQuery(
    getUserListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        keyword: search.keyword,
        status: search.status ? [search.status] : undefined,
        sortBy: search.sortBy,
        sortOrder: search.sortOrder,
      },
    }),
  );

  const rows = useMemo(
    () => (data?.items ?? []).map((user) => toUserRowVM(user, permission, profile.data?.user.id)),
    [data, permission, profile.data],
  );

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
            {t(`user.status.${row.original.status}`)}
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
                  // 停用的理由在外層 Tooltip 裡，按鈕要保持可聚焦才讀得到
                  focusableWhenDisabled
                  onClick={() => setPendingDelete(row.original)}
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
    [permission, resetPassword, search, t, unlockUser],
  );

  return (
    <div className="flex flex-col gap-4" data-testid="user-list-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('user.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('user.list.description')}</p>
        </div>
        {permission.canCreate && (
          <Button
            variant="primary"
            onClick={() => void navigate({ to: UserCreateRoute.to, search })}
            data-testid="user-create-button"
          >
            {t('user.create.action')}
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t('user.list.searchPlaceholder')}
          value={keywordDraft}
          onChange={(event) => setKeywordDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') patch({ keyword: keywordDraft || undefined, offset: 0 });
          }}
          className="max-w-xs"
          data-testid="user-search-input"
        />
        <Select
          value={search.status ?? 'all'}
          onValueChange={(value) =>
            patch({
              status: value === 'all' ? undefined : (value as UserSearchQuery['status']),
              offset: 0,
            })
          }
          options={[
            { value: 'all', label: t('user.status.all') },
            { value: 'active', label: t('user.status.active') },
            { value: 'pending', label: t('user.status.pending') },
            { value: 'inactive', label: t('user.status.inactive') },
            { value: 'locked', label: t('user.status.locked') },
          ]}
          className="w-40"
          aria-label={t('user.field.status')}
        />
        <Button onClick={() => patch({ keyword: keywordDraft || undefined, offset: 0 })}>
          {t('common.search')}
        </Button>
      </div>

      <Table
        data={rows}
        columns={columns}
        loading={isPending}
        getRowId={(row) => row.id}
        emptyTitle={t('common.empty')}
        sorting={{ sortBy: search.sortBy, sortOrder: search.sortOrder }}
        onSortingChange={(sortBy, sortOrder) =>
          patch({ sortBy: sortBy as UserSearchQuery['sortBy'], sortOrder, offset: 0 })
        }
        onRowDoubleClick={(row) =>
          void navigate({ to: UserDetailRoute.to, params: { userId: row.id }, search })
        }
        data-testid="user-table"
      />

      <Pagination
        offset={search.offset}
        limit={search.limit}
        total={data?.pagination.total ?? 0}
        onChange={({ offset, limit }) => patch({ offset, limit })}
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          summary: ({ from, to, total }) => `${from}-${to} / ${total}`,
        }}
      />

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(undefined)}
        title={t('user.delete.title')}
        description={t('user.delete.confirm', { name: pendingDelete?.displayName ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={deleteUser.isPending}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteUser
            .mutateAsync({ params: { userId: pendingDelete.id } })
            .catch(() => undefined);
          setPendingDelete(undefined);
        }}
      />

      <Outlet />
    </div>
  );
}
