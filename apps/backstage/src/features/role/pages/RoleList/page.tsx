import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { getRoleListQueryOptions } from '@/apis/role/get-role-list/query';
import { AlertDialog } from '@/components/AlertDialog';
import { ButtonLink } from '@/components/Button';
import { useTableSelection } from '@/components/Table';
import { useTranslation } from '@/core/locales';

import { useRoleDeleteMutation } from '../../hooks/useRoleMutations';
import { useRolePermission } from '../../hooks/useRolePermission';
import { ROLE_LIST_TABLE_ID } from '../../preference';
import { RoleCreateRoute, RoleDetailRoute } from '../../routes';
import { toRoleRowVM } from './adapter';
import type { RoleRowVM } from './adapter';
import { RoleTable } from './components/RoleTable';
import { useRoleBatchActions } from './useRoleBatchActions';
import { useRoleFilters } from './useRoleFilters';
import { useRoleSearchFilter } from './useRoleSearchFilter';

export default function RoleListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useRolePermission();
  const searchFilter = useRoleSearchFilter();
  const { search, setSort, setPage } = searchFilter;
  const batchActions = useRoleBatchActions();
  const [pendingDelete, setPendingDelete] = useState<RoleRowVM>();
  const deleteRole = useRoleDeleteMutation();

  const { data, isPending, error, refetch } = useQuery(
    getRoleListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        keyword: search.keyword,
        sort: search.sort,
      },
    }),
  );

  const rows = useMemo(
    () => (data?.items ?? []).map((role) => toRoleRowVM(role, permission)),
    [data, permission],
  );
  const selection = useTableSelection(rows, getRowId);
  // 關鍵字改變後，原本勾選的列可能不在結果裡了：清空選取（排序只是換順序，保留）
  const filters = useRoleFilters({
    ...searchFilter,
    setFilters: (next) => {
      if (next.keyword !== search.keyword) selection.clear();
      searchFilter.setFilters(next);
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="role-list-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('role.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('role.list.description')}</p>
        </div>
        {/* 使用者永遠不會有這個權限時直接隱藏 */}
        {permission.canCreate && (
          <ButtonLink
            variant="primary"
            to={RoleCreateRoute.to}
            search={search}
            data-testid="role-create-button"
          >
            {t('role.create.action')}
          </ButtonLink>
        )}
      </header>

      <RoleTable
        rows={rows}
        loading={isPending}
        search={search}
        onSortingChange={setSort}
        onRowDoubleClick={(row) =>
          void navigate({ to: RoleDetailRoute.to, params: { roleId: row.id }, search })
        }
        onDelete={setPendingDelete}
        filters={filters}
        searchBox={{
          value: search.keyword,
          onChange: (keyword) => filters.onSubmit({ ...filters.value, keyword }),
          placeholder: t('role.list.searchPlaceholder'),
        }}
        error={error}
        onRetry={() => void refetch()}
        batch={{ scope: ROLE_LIST_TABLE_ID, selection, actions: batchActions, getRowLabel }}
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
        title={t('role.delete.title')}
        // 有人持有時先說清楚影響人數，並直接提供「仍要刪除」；不要等確認後才被 ROLE_IN_USE 擋下（UX-18）
        description={
          pendingDelete && pendingDelete.userCount > 0
            ? t('role.delete.confirmInUse', {
                name: pendingDelete.name,
                count: pendingDelete.userCount,
              })
            : t('role.delete.confirm', { name: pendingDelete?.name ?? '' })
        }
        confirmLabel={
          pendingDelete && pendingDelete.userCount > 0
            ? t('role.delete.force', { count: pendingDelete.userCount })
            : t('common.delete')
        }
        cancelLabel={t('common.cancel')}
        loading={deleteRole.isPending}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteRole.mutateAsync({
              params: { roleId: pendingDelete.id, force: pendingDelete.userCount > 0 },
            });
          } catch {
            // 錯誤由 mutation 的 onError 顯示；對話框留著讓使用者重試或取消
            return;
          }
          setPendingDelete(undefined);
        }}
        data-testid="role-delete-confirm"
      />

      {/* 對話框子路由（建立／詳情）掛在列表頁內，列表在背後保持掛載 */}
      <Outlet />
    </div>
  );
}

const getRowId = (row: RoleRowVM) => row.id;
const getRowLabel = (row: RoleRowVM) => row.name;
