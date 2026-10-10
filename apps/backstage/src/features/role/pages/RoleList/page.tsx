import { AlertDialog } from '@b2b-system/ui/AlertDialog';
import { ButtonLink } from '@b2b-system/ui/Button';
import { PageHeader } from '@b2b-system/ui/PageHeader';
import { useTableSelection } from '@b2b-system/ui/Table';
import type { BatchAction } from '@b2b-system/web-core/batch';
import { ExportDialog } from '@b2b-system/web-core/data-transfer';
import { ErrorCodes, isAppError } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useListSearch } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { fetchRoleListQuery } from '@/apis/role/get-role-list/fetcher';
import { getRoleListQueryOptions } from '@/apis/role/get-role-list/query';
import { TransferActions } from '@/core/components/TransferActions';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

import { roleExportApi } from '../../hooks/roleTransferApi';
import { useRoleDeleteMutation } from '../../hooks/useRoleMutations';
import { useRolePermission } from '../../hooks/useRolePermission';
import { ROLE_LIST_TABLE_ID } from '../../preference';
import { RoleCreateRoute, RoleDetailRoute, RoleImportRoute, RoleListRoute } from '../../routes';
import type { RoleSearchQuery } from '../../routes';
import { toRoleRowVM } from './adapter';
import type { RoleRowVM } from './adapter';
import { RoleTable } from './components/RoleTable';
import { useRoleBatchActions } from './useRoleBatchActions';
import { useRoleFilters } from './useRoleFilters';

export default function RoleListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useRolePermission();
  const searchFilter = useListSearch<RoleSearchQuery>(RoleListRoute);
  const { search, setSort, setPage } = searchFilter;
  const batchActions = useRoleBatchActions();
  const [pendingDelete, setPendingDelete] = useState<RoleRowVM>();
  const deleteRole = useRoleDeleteMutation();
  // 回收桶被平台關掉時，確認文字不提「移到回收桶、可以還原」（那時沒有地方可以還原）
  const confirmKeys = useIsFeatureReady(TenantFeature.trash)
    ? ({ inUse: 'role.delete.confirmInUse', unused: 'role.delete.confirm' } as const)
    : ({ inUse: 'role.delete.confirmInUseNoTrash', unused: 'role.delete.confirmNoTrash' } as const);
  /** 匯出對話框：開啟時的範圍（docs/architecture/backend/22-data-transfer.md §8.2）。 */
  const [exporting, setExporting] = useState<{ ids: string[]; allMatching: boolean } | null>(null);

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
  // 批次列的「匯出選取」：不入佇列，開匯出對話框；「選取全部符合」時以篩選條件匯出
  const actions = useMemo<Array<BatchAction<RoleRowVM>>>(
    () => [
      ...batchActions,
      {
        kind: 'run',
        id: 'export',
        label: t('dataTransfer.export.selectedAction'),
        hidden: !permission.hydrated || !permission.canExport,
        run: ({ rows: targets, allMatching }) =>
          setExporting({ ids: targets.map((target) => target.id), allMatching }),
      },
    ],
    [batchActions, permission.canExport, permission.hydrated, t],
  );
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
      <PageHeader
        title={t('role.list.title')}
        description={t('role.list.description')}
        actions={
          <>
            <TransferActions
              exports={
                permission.canExport
                  ? [
                      {
                        key: 'role',
                        label: '',
                        onSelect: () => setExporting({ ids: [], allMatching: false }),
                      },
                    ]
                  : []
              }
              imports={
                permission.canImport
                  ? [{ key: 'role', to: RoleImportRoute.to, search: { mode: 'create' } }]
                  : []
              }
              testIds={{ exportButton: 'role-export-button', importButton: 'role-import-button' }}
            />
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
          </>
        }
      />

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
          actions,
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

      <ExportDialog
        open={exporting !== null}
        onOpenChange={(open) => !open && setExporting(null)}
        api={roleExportApi}
        type="role"
        selectedIds={exporting?.ids}
        allMatchingSelected={exporting?.allMatching}
        filter={{ keyword: search.keyword }}
        matchingTotal={data?.pagination.total ?? 0}
        data-testid="role-export-dialog"
      />

      {/* 宣告式的 AlertDialog 而不是 useConfirm：收到 ROLE_IN_USE 時要在同一個對話框裡換成「強制刪除」的說明，
        useConfirm 開出來之後內容不能改（docs/architecture/frontend/07-ui-system.md §3.11） */}
      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(undefined)}
        title={t('role.delete.title')}
        // 有人持有時先說清楚影響人數，並直接提供「仍要刪除」；不要等確認後才被 ROLE_IN_USE 擋下
        description={
          pendingDelete && pendingDelete.userCount > 0
            ? t(confirmKeys.inUse, { name: pendingDelete.name, count: pendingDelete.userCount })
            : t(confirmKeys.unused, { name: pendingDelete?.name ?? '' })
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
