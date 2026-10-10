import { ButtonLink } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { PageHeader } from '@b2b-system/ui/PageHeader';
import { ExportDialog } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useListSearch } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import { getGroupListQueryOptions } from '@/apis/group/get-group-list/query';
import { TransferActions } from '@/core/components/TransferActions';
import { useIsFeatureReady } from '@/core/feature';
import { TenantFeature } from '@/shared/api-sdk';

import { groupExportApi } from '../../hooks/groupTransferApi';
import { useGroupDeleteMutation } from '../../hooks/useGroupMutations';
import { useGroupPermission } from '../../hooks/useGroupPermission';
import { GroupListRoute } from '../../routes';
import type { GroupSearchQuery } from '../../routes';
import {
  GroupCreateRoute,
  GroupDetailRoute,
  GroupImportRoute,
  GroupMemberImportRoute,
} from '../../routes';
import { toGroupRowVM } from './adapter';
import type { GroupRowVM } from './adapter';
import { GroupTable } from './components/GroupTable';

export default function GroupListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useGroupPermission();
  const { search, setKeyword, setSort, setPage } = useListSearch<GroupSearchQuery>(GroupListRoute);
  const { mutateAsync: deleteGroup } = useGroupDeleteMutation();
  const confirm = useConfirm();
  // 回收桶被平台關掉時，確認文字不提「移到回收桶、可以還原」
  const hasTrash = useIsFeatureReady(TenantFeature.trash);
  // 成員會失去群組帶來的權限：先說清楚人數（直接成員；巢狀群組的成員另計）。
  // 失敗時對話框留著讓使用者重試或取消，錯誤由 mutation 的 onError 顯示（docs/architecture/frontend/07-ui-system.md §3.11）
  const confirmDelete = useCallback(
    (row: GroupRowVM) =>
      void confirm({
        title: t('group.delete.title'),
        description: hasTrash
          ? t('group.delete.confirm', { name: row.name, count: row.memberCount })
          : t('group.delete.confirmNoTrash', { name: row.name, count: row.memberCount }),
        confirmLabel: t('common.delete'),
        tone: 'danger',
        onConfirm: () => deleteGroup({ params: { groupId: row.id } }),
        'data-testid': 'group-delete-confirm',
      }),
    [confirm, deleteGroup, hasTrash, t],
  );
  /** 匯出對話框：群組或群組成員（docs/architecture/backend/22-data-transfer.md §12.2）。 */
  const [exporting, setExporting] = useState<'group' | 'groupMember' | null>(null);

  const { data, isPending, error, refetch } = useQuery(
    getGroupListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        keyword: search.keyword,
        sort: search.sort,
      },
    }),
  );
  const rows = useMemo(() => (data?.items ?? []).map(toGroupRowVM), [data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="group-list-page">
      <PageHeader
        title={t('group.list.title')}
        description={t('group.list.description')}
        actions={
          <>
            <TransferActions
              exports={
                permission.canExport
                  ? [
                      {
                        key: 'group',
                        label: t('group.transfer.groups'),
                        onSelect: () => setExporting('group'),
                      },
                      {
                        key: 'groupMember',
                        label: t('group.transfer.members'),
                        onSelect: () => setExporting('groupMember'),
                      },
                    ]
                  : []
              }
              imports={
                permission.canImport
                  ? [
                      {
                        key: 'group',
                        label: t('group.transfer.groups'),
                        to: GroupImportRoute.to,
                        search: { mode: 'create' },
                      },
                      ...(permission.canImportMembers
                        ? [
                            {
                              key: 'groupMember',
                              label: t('group.transfer.members'),
                              to: GroupMemberImportRoute.to,
                              search: { mode: 'create' },
                            },
                          ]
                        : []),
                    ]
                  : []
              }
              testIds={{
                exportButton: 'group-export-button',
                exportMenu: 'group-export-menu',
                importButton: 'group-import-button',
                importMenu: 'group-import-menu',
              }}
            />
            {permission.canCreate && (
              <ButtonLink
                variant="primary"
                to={GroupCreateRoute.to}
                search={search}
                data-testid="group-create-button"
              >
                {t('group.create.action')}
              </ButtonLink>
            )}
          </>
        }
      />

      <GroupTable
        rows={rows}
        loading={isPending}
        search={search}
        canDelete={permission.canDelete}
        onSortingChange={setSort}
        onRowDoubleClick={(row) =>
          void navigate({ to: GroupDetailRoute.to, params: { groupId: row.id }, search })
        }
        onDelete={confirmDelete}
        searchBox={{
          value: search.keyword,
          onChange: setKeyword,
          placeholder: t('group.list.searchPlaceholder'),
        }}
        error={error}
        onRetry={() => void refetch()}
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
        api={groupExportApi}
        type={exporting ?? 'group'}
        filter={exporting === 'groupMember' ? {} : { keyword: search.keyword }}
        matchingTotal={exporting === 'groupMember' ? undefined : (data?.pagination.total ?? 0)}
        data-testid="group-export-dialog"
      />

      {/* 對話框子路由（建立／詳情）掛在列表頁內，列表在背後保持掛載 */}
      <Outlet />
    </div>
  );
}
