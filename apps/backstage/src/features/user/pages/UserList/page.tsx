import { Button, ButtonLink } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Icon } from '@b2b-system/ui/Icon';
import { useTableSelection } from '@b2b-system/ui/Table';
import type { BatchAction } from '@b2b-system/web-core/batch';
import { ExportDialog } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';
import { getOrgUnitTreeQueryOptions } from '@/apis/org-unit/get-org-unit-tree/query';
import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';
import { getTagListQueryOptions } from '@/apis/tag/get-tag-list/query';
import { fetchUserListQuery } from '@/apis/user/get-user-list/fetcher';
import { getUserListQueryOptions } from '@/apis/user/get-user-list/query';
import type { UserListParams } from '@/apis/user/types';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

import { userExportApi } from '../../hooks/userTransferApi';
import { useUserDeleteMutation } from '../../hooks/useUserMutations';
import { useUserPermission } from '../../hooks/useUserPermission';
import { USER_LIST_TABLE_ID } from '../../preference';
import { UserCreateRoute, UserDetailRoute, UserImportRoute } from '../../routes';
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
  /** 匯出對話框：開啟時的範圍（docs/architecture/backend/22-data-transfer.md §8.2）。 */
  const [exporting, setExporting] = useState<{ ids: string[]; allMatching: boolean } | null>(null);

  const profile = useQuery(getAuthProfileQueryOptions());
  const { mutateAsync: removeUser } = useUserDeleteMutation();
  const confirm = useConfirm();
  // 回收桶被平台關掉時，確認文字不提「移到回收桶、可以還原」（那時沒有地方可以還原）
  const hasTrash = useIsFeatureReady(TenantFeature.trash);
  // 失敗時對話框留著讓使用者重試或取消，錯誤由 mutation 的 onError 顯示（docs/architecture/frontend/07-ui-system.md §3.11）
  // 參考固定（`mutateAsync` 不隨 render 改變）：表格的欄位定義以它為依賴
  const confirmDelete = useCallback(
    (row: UserRowVM) =>
      void confirm({
        title: t('user.delete.title'),
        description: hasTrash
          ? t('user.delete.confirm', { name: row.displayName })
          : t('user.delete.confirmNoTrash', { name: row.displayName }),
        confirmLabel: t('common.delete'),
        tone: 'danger',
        onConfirm: () => removeUser({ params: { userId: row.id } }),
        'data-testid': 'user-delete-confirm',
      }),
    [confirm, hasTrash, removeUser, t],
  );
  // 篩選面板的標籤選項（`user` 標籤組；讀得到使用者列表就讀得到，docs/architecture/backend/18-tag.md §7.2 D5）
  const tags = useQuery(getTagListQueryOptions('user'));
  // 篩選面板的部門樹；租戶沒有啟用 `organization` 時不查、不帶部門參數（後端會回 VALIDATION_FAILED）
  const canFilterOrgUnit = permission.canReadOrgUnits;
  const orgUnits = useQuery({ ...getOrgUnitTreeQueryOptions(), enabled: canFilterOrgUnit });
  // 篩選面板的角色；沒有 role:read 時不提供角色篩選
  const roleOptions = useQuery({
    ...getRoleOptionsQueryOptions(),
    enabled: permission.canReadRoles,
  });

  const listParams: UserListParams = {
    offset: search.offset,
    limit: search.limit,
    keyword: search.keyword,
    status: search.status ? [search.status] : undefined,
    mfa: search.mfa,
    roleId: permission.canReadRoles ? search.roleId : undefined,
    includeGroupRoles: permission.canReadRoles && search.includeGroupRoles === 'true',
    tagId: search.tagId,
    orgUnitId: canFilterOrgUnit ? search.orgUnitId : undefined,
    includeDescendants: canFilterOrgUnit && search.includeDescendants === 'true',
    sort: search.sort,
  };
  const { data, isPending, error, refetch } = useQuery(
    getUserListQueryOptions({ params: listParams }),
  );

  // 只依賴 adapter 用到的值：與資料、權限、自己是誰無關的重繪不重建列
  const { canDelete, canUpdate, canUnlock } = permission;
  const currentUserId = profile.data?.user.id;
  const rows = useMemo(
    () =>
      (data?.items ?? []).map((user) =>
        toUserRowVM(user, { canDelete, canUpdate, canUnlock }, currentUserId),
      ),
    [data, canDelete, canUpdate, canUnlock, currentUserId],
  );
  const selection = useTableSelection(rows, getRowId);
  // 批次列的「匯出選取」：不入佇列，開匯出對話框；「選取全部符合」時以篩選條件匯出（D3）
  const actions = useMemo<Array<BatchAction<UserRowVM>>>(
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
  /** 匯出的篩選條件：列表 API 的同一個物件，去掉分頁與排序（匯出固定依建立時間排序）。 */
  const exportFilter = useMemo(
    () => ({
      keyword: search.keyword,
      status: listParams.status,
      mfa: search.mfa,
      roleId: listParams.roleId,
      includeGroupRoles: listParams.includeGroupRoles ? ('true' as const) : undefined,
      tagId: search.tagId,
      // 部門篩選也套到匯出（docs/architecture/backend/23-organization.md §4）
      orgUnitId: listParams.orgUnitId,
      includeDescendants: listParams.includeDescendants ? ('true' as const) : undefined,
    }),
    [
      listParams.status,
      listParams.roleId,
      listParams.includeGroupRoles,
      listParams.orgUnitId,
      listParams.includeDescendants,
      search.keyword,
      search.mfa,
      search.tagId,
    ],
  );
  // 篩選條件改變後，原本勾選的列可能不在結果裡了：清空選取（排序只是換順序，保留）
  const filters = useUserFilters(
    {
      ...searchFilter,
      setFilters: (next) => {
        if (
          next.keyword !== search.keyword ||
          next.status !== search.status ||
          next.mfa !== search.mfa ||
          next.roleId?.join(',') !== search.roleId?.join(',') ||
          next.includeGroupRoles !== search.includeGroupRoles ||
          next.tagId?.join(',') !== search.tagId?.join(',') ||
          next.orgUnitId !== search.orgUnitId ||
          next.includeDescendants !== search.includeDescendants
        ) {
          selection.clear();
        }
        searchFilter.setFilters(next);
      },
    },
    tags.data?.items,
    canFilterOrgUnit ? { units: orgUnits.data?.items, loading: orgUnits.isPending } : undefined,
    permission.canReadRoles ? roleOptions.data?.items : undefined,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="user-list-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('user.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('user.list.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          {permission.canExport && (
            <Button
              variant="secondary"
              startIcon={<Icon name="download" size={16} />}
              onClick={() => setExporting({ ids: [], allMatching: false })}
              data-testid="user-export-button"
            >
              {t('dataTransfer.export.action')}
            </Button>
          )}
          {permission.canImport && (
            <ButtonLink
              variant="secondary"
              to={UserImportRoute.to}
              search={{ mode: 'create' }}
              startIcon={<Icon name="upload" size={16} />}
              data-testid="user-import-button"
            >
              {t('dataTransfer.import.action')}
            </ButtonLink>
          )}
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
        </div>
      </header>

      <UserTable
        rows={rows}
        loading={isPending}
        search={search}
        onSortingChange={setSort}
        onRowDoubleClick={(row) =>
          void navigate({ to: UserDetailRoute.to, params: { userId: row.id }, search })
        }
        onDelete={confirmDelete}
        filters={filters}
        searchBox={{
          value: search.keyword,
          onChange: (keyword) => filters.onSubmit({ ...filters.value, keyword }),
          placeholder: t('user.list.searchPlaceholder'),
        }}
        error={error}
        onRetry={() => void refetch()}
        batch={{
          scope: USER_LIST_TABLE_ID,
          selection,
          actions,
          getRowLabel,
          getRowVersion,
          // 「選取全部符合」：同樣的篩選與排序逐頁取回（docs/architecture/frontend/07-ui-system.md §13.7）
          selectAllMatching: {
            total: data?.pagination.total ?? 0,
            fetchPage: async (offset, limit, signal) => {
              const page = await fetchUserListQuery({
                params: { ...listParams, offset, limit },
                signal,
              });
              return {
                items: page.items.map((user) =>
                  toUserRowVM(user, { canDelete, canUpdate, canUnlock }, currentUserId),
                ),
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
        api={userExportApi}
        type="user"
        selectedIds={exporting?.ids}
        allMatchingSelected={exporting?.allMatching}
        filter={exportFilter}
        matchingTotal={data?.pagination.total ?? 0}
        data-testid="user-export-dialog"
      />

      <Outlet />
    </div>
  );
}

const getRowId = (row: UserRowVM) => row.id;
const getRowLabel = (row: UserRowVM) => row.email;
const getRowVersion = (row: UserRowVM) => row.version;
