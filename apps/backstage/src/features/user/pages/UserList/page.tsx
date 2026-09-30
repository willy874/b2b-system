import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getUserListQueryOptions } from '@/apis/user/get-user-list/query';
import { AlertDialog } from '@/components/AlertDialog';
import { ButtonLink } from '@/components/Button';
import { useTableSelection } from '@/components/Table';
import { useTranslation } from '@/core/locales';

import { useUserDeleteMutation } from '../../hooks/useUserMutations';
import { useUserPermission } from '../../hooks/useUserPermission';
import { USER_LIST_TABLE_ID } from '../../preference';
import { UserCreateRoute, UserDetailRoute } from '../../routes';
import { toUserRowVM } from './adapter';
import type { UserRowVM } from './adapter';
import { UserTable } from './components/UserTable';
import { useUserBatchActions } from './useUserBatchActions';
import { useUserFilters } from './useUserFilters';
import { useUserSearchFilter } from './useUserSearchFilter';

export default function UserListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useUserPermission();
  const searchFilter = useUserSearchFilter();
  const { search, setSort, setPage } = searchFilter;
  const batchActions = useUserBatchActions();
  const [pendingDelete, setPendingDelete] = useState<UserRowVM>();

  const profile = useQuery(getAuthProfileQueryOptions());
  const deleteUser = useUserDeleteMutation();

  const { data, isPending, error, refetch } = useQuery(
    getUserListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        keyword: search.keyword,
        status: search.status ? [search.status] : undefined,
        sort: search.sort,
      },
    }),
  );

  const rows = useMemo(
    () => (data?.items ?? []).map((user) => toUserRowVM(user, permission, profile.data?.user.id)),
    [data, permission, profile.data],
  );
  const selection = useTableSelection(rows, getRowId);
  // 篩選條件改變後，原本勾選的列可能不在結果裡了：清空選取（排序只是換順序，保留）
  const filters = useUserFilters({
    ...searchFilter,
    setFilters: (next) => {
      if (next.keyword !== search.keyword || next.status !== search.status) selection.clear();
      searchFilter.setFilters(next);
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="user-list-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('user.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('user.list.description')}</p>
        </div>
        {permission.canCreate && (
          <ButtonLink
            variant="primary"
            to={UserCreateRoute.to}
            search={search}
            data-testid="user-create-button"
          >
            {t('user.create.action')}
          </ButtonLink>
        )}
      </header>

      <UserTable
        rows={rows}
        loading={isPending}
        search={search}
        onSortingChange={setSort}
        onRowDoubleClick={(row) =>
          void navigate({ to: UserDetailRoute.to, params: { userId: row.id }, search })
        }
        onDelete={setPendingDelete}
        filters={filters}
        searchBox={{
          value: search.keyword,
          onChange: (keyword) => filters.onSubmit({ ...filters.value, keyword }),
          placeholder: t('user.list.searchPlaceholder'),
        }}
        error={error}
        onRetry={() => void refetch()}
        batch={{ scope: USER_LIST_TABLE_ID, selection, actions: batchActions, getRowLabel }}
        pagination={{
          offset: search.offset,
          limit: search.limit,
          total: data?.pagination.total ?? 0,
          onChange: ({ offset, limit }) => setPage(offset, limit),
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

const getRowId = (row: UserRowVM) => row.id;
const getRowLabel = (row: UserRowVM) => row.email;
