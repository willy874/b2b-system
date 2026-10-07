import { AlertDialog } from '@b2b-system/ui/AlertDialog';
import { ButtonLink } from '@b2b-system/ui/Button';
import { useTableSelection } from '@b2b-system/ui/Table';
import { ErrorCodes, isAppError } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { fetchRoleListQuery } from '@/apis/role/get-role-list/fetcher';
import { getRoleListQueryOptions } from '@/apis/role/get-role-list/query';

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

  const listParams = {
    offset: search.offset,
    limit: search.limit,
    keyword: search.keyword,
    sort: search.sort,
  };
  const { data, isPending, error, refetch } = useQuery(
    getRoleListQueryOptions({ params: listParams }),
  );

  // 只依賴 adapter 用到的布林值：與資料、這兩個權限無關的重繪不重建列（選取、表格的 row model 跟著不變）
  const { canDelete, canUpdate } = permission;
  const rows = useMemo(
    () => (data?.items ?? []).map((role) => toRoleRowVM(role, { canDelete, canUpdate })),
    [data, canDelete, canUpdate],
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
        batch={{
          scope: ROLE_LIST_TABLE_ID,
          selection,
          actions: batchActions,
          getRowLabel,
          // 「選取全部符合」：同樣的篩選與排序逐頁取回（docs/architecture/frontend/07-ui-system.md §13.7）
          selectAllMatching: {
            total: data?.pagination.total ?? 0,
            fetchPage: async (offset, limit, signal) => {
              const page = await fetchRoleListQuery({
                params: { ...listParams, offset, limit },
                signal,
              });
              return {
                items: page.items.map((role) => toRoleRowVM(role, { canDelete, canUpdate })),
                total: page.pagination.total,
              };
            },
          },
        }}
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
        // 有人持有時先說清楚影響人數，並直接提供「仍要刪除」；不要等確認後才被 ROLE_IN_USE 擋下
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
          } catch (reason) {
            // 列表的 userCount 只算直接持有者；只由群組持有的角色要到刪除時才知道有人會失去權限
            // （ROLE_IN_USE 的 details.userCount 含群組的成員）：改成「仍要刪除」的確認，讓使用者決定要不要強制
            const inUse = inUseCountOf(reason);
            if (inUse > 0) setPendingDelete({ ...pendingDelete, userCount: inUse });
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

/** `ROLE_IN_USE` 的持有人數（含經由群組持有的）；其他錯誤是 0。 */
function inUseCountOf(error: unknown): number {
  if (!isAppError(error) || error.code !== ErrorCodes.ROLE_IN_USE) return 0;
  const count = error.details?.userCount;
  return typeof count === 'number' ? count : 0;
}
