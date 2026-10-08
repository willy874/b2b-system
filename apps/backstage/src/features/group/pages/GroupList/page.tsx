import { AlertDialog } from '@b2b-system/ui/AlertDialog';
import { Button, ButtonLink } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Menu } from '@b2b-system/ui/Menu';
import { ExportDialog } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { getGroupListQueryOptions } from '@/apis/group/get-group-list/query';

import { groupExportApi } from '../../hooks/groupTransferApi';
import { useGroupDeleteMutation } from '../../hooks/useGroupMutations';
import { useGroupPermission } from '../../hooks/useGroupPermission';
import {
  GroupCreateRoute,
  GroupDetailRoute,
  GroupImportRoute,
  GroupMemberImportRoute,
} from '../../routes';
import { toGroupRowVM } from './adapter';
import type { GroupRowVM } from './adapter';
import { GroupTable } from './components/GroupTable';
import { useGroupSearchFilter } from './useGroupSearchFilter';

export default function GroupListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useGroupPermission();
  const { search, setKeyword, setSort, setPage } = useGroupSearchFilter();
  const [pendingDelete, setPendingDelete] = useState<GroupRowVM>();
  const deleteGroup = useGroupDeleteMutation();
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
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('group.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('group.list.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          {permission.canExport && (
            <Menu
              align="end"
              trigger={
                <Button
                  variant="secondary"
                  startIcon={<Icon name="download" size={16} />}
                  endIcon={<Icon name="chevron-down" size={14} />}
                  data-testid="group-export-button"
                >
                  {t('dataTransfer.export.action')}
                </Button>
              }
              items={[
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
              ]}
              data-testid="group-export-menu"
            />
          )}
          {permission.canImport && (
            <Menu
              align="end"
              trigger={
                <Button
                  variant="secondary"
                  startIcon={<Icon name="upload" size={16} />}
                  endIcon={<Icon name="chevron-down" size={14} />}
                  data-testid="group-import-button"
                >
                  {t('dataTransfer.import.action')}
                </Button>
              }
              items={[
                {
                  key: 'group',
                  label: t('group.transfer.groups'),
                  onSelect: () =>
                    void navigate({ to: GroupImportRoute.to, search: { mode: 'create' } }),
                },
                ...(permission.canImportMembers
                  ? [
                      {
                        key: 'groupMember',
                        label: t('group.transfer.members'),
                        onSelect: () =>
                          void navigate({
                            to: GroupMemberImportRoute.to,
                            search: { mode: 'create' as const },
                          }),
                      },
                    ]
                  : []),
              ]}
              data-testid="group-import-menu"
            />
          )}
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
        </div>
      </header>

      <GroupTable
        rows={rows}
        loading={isPending}
        search={search}
        canDelete={permission.canDelete}
        onSortingChange={setSort}
        onRowDoubleClick={(row) =>
          void navigate({ to: GroupDetailRoute.to, params: { groupId: row.id }, search })
        }
        onDelete={setPendingDelete}
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

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(undefined)}
        title={t('group.delete.title')}
        // 成員會失去群組帶來的權限：先說清楚人數（直接成員；巢狀群組的成員另計）
        description={t('group.delete.confirm', {
          name: pendingDelete?.name ?? '',
          count: pendingDelete?.memberCount ?? 0,
        })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={deleteGroup.isPending}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteGroup.mutateAsync({ params: { groupId: pendingDelete.id } });
          } catch {
            // 錯誤由 mutation 的 onError 顯示；對話框留著讓使用者重試或取消
            return;
          }
          setPendingDelete(undefined);
        }}
        data-testid="group-delete-confirm"
      />

      {/* 對話框子路由（建立／詳情）掛在列表頁內，列表在背後保持掛載 */}
      <Outlet />
    </div>
  );
}
