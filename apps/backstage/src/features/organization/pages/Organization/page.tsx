import { AlertDialog } from '@b2b-system/ui/AlertDialog';
import { Button } from '@b2b-system/ui/Button';
import { Empty } from '@b2b-system/ui/Empty';
import { Icon } from '@b2b-system/ui/Icon';
import { Menu } from '@b2b-system/ui/Menu';
import { Tabs } from '@b2b-system/ui/Tabs';
import { ExportDialog } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { getOrgUnitTreeQueryOptions } from '@/apis/org-unit/get-org-unit-tree/query';
import type { OrgUnitDetail } from '@/shared/api-sdk';

import { orgUnitExportApi } from '../../hooks/orgUnitTransferApi';
import { useOrgUnitDeleteMutation } from '../../hooks/useOrgUnitMutations';
import { useOrgUnitPermission } from '../../hooks/useOrgUnitPermission';
import { OrganizationRoute, OrgUnitImportRoute, OrgUnitMemberImportRoute } from '../../routes';
import { OrgChartPanel } from './components/OrgChartPanel';
import { OrgUnitCreateDialog } from './components/OrgUnitCreateDialog';
import type { OrgUnitCreateTarget } from './components/OrgUnitCreateDialog';
import { OrgUnitDetailPanel } from './components/OrgUnitDetailPanel';
import { OrgUnitMoveDialog } from './components/OrgUnitMoveDialog';
import { OrgUnitTreePanel } from './components/OrgUnitTreePanel';

/** 預設的清單不寫進網址。 */
const searchOf = (unitId: string | undefined, view: string) => ({
  unitId,
  view: view === 'chart' ? ('chart' as const) : undefined,
});

/**
 * 組織（docs/architecture/backend/23-organization.md §8）：
 * 清單是左側部門樹、右側選中部門的詳情與成員；組織圖以 TreeEditor 畫出整棵樹，可進入編輯模式調整結構。
 */
export default function OrganizationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { unitId, view = 'list' } = OrganizationRoute.useSearch();
  const permission = useOrgUnitPermission();
  const tree = useQuery(getOrgUnitTreeQueryOptions());
  const deleteUnit = useOrgUnitDeleteMutation();
  const [creating, setCreating] = useState<OrgUnitCreateTarget>();
  const [moving, setMoving] = useState<OrgUnitDetail>();
  const [pendingDelete, setPendingDelete] = useState<OrgUnitDetail>();
  /** 匯出對話框：部門或成員（選中部門時是它與下層的成員，docs/architecture/backend/22-data-transfer.md §12.3）。 */
  const [exporting, setExporting] = useState<'orgUnit' | 'orgUnitMember' | null>(null);

  const select = (id: string | undefined) =>
    void navigate({ to: OrganizationRoute.to, search: searchOf(id, view) });
  const changeView = (next: string) =>
    void navigate({ to: OrganizationRoute.to, search: searchOf(unitId, next) });

  const detail = unitId ? (
    <OrgUnitDetailPanel
      key={unitId}
      unitId={unitId}
      permission={permission}
      onCreateChild={(unit) => setCreating({ parentId: unit.id, parentName: unit.name })}
      onMove={setMoving}
      onDelete={setPendingDelete}
      onBack={() => select(undefined)}
    />
  ) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="organization-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('organization.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {t('organization.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {permission.hydrated && permission.canExport && (
            <Menu
              align="end"
              trigger={
                <Button
                  variant="secondary"
                  startIcon={<Icon name="download" size={16} />}
                  endIcon={<Icon name="chevron-down" size={14} />}
                  data-testid="org-unit-export-button"
                >
                  {t('dataTransfer.export.action')}
                </Button>
              }
              items={[
                {
                  key: 'orgUnit',
                  label: t('organization.transfer.units'),
                  onSelect: () => setExporting('orgUnit'),
                },
                {
                  key: 'orgUnitMember',
                  label: unitId
                    ? t('organization.transfer.membersOfUnit')
                    : t('organization.transfer.members'),
                  onSelect: () => setExporting('orgUnitMember'),
                },
              ]}
              data-testid="org-unit-export-menu"
            />
          )}
          {permission.hydrated && permission.canImport && (
            <Menu
              align="end"
              trigger={
                <Button
                  variant="secondary"
                  startIcon={<Icon name="upload" size={16} />}
                  endIcon={<Icon name="chevron-down" size={14} />}
                  data-testid="org-unit-import-button"
                >
                  {t('dataTransfer.import.action')}
                </Button>
              }
              items={[
                {
                  key: 'orgUnit',
                  label: t('organization.transfer.units'),
                  onSelect: () =>
                    void navigate({ to: OrgUnitImportRoute.to, search: { mode: 'create' } }),
                },
                ...(permission.canImportMembers
                  ? [
                      {
                        key: 'orgUnitMember',
                        label: t('organization.transfer.members'),
                        onSelect: () =>
                          void navigate({
                            to: OrgUnitMemberImportRoute.to,
                            search: { mode: 'create' as const },
                          }),
                      },
                    ]
                  : []),
              ]}
              data-testid="org-unit-import-menu"
            />
          )}
          {view === 'list' && permission.hydrated && permission.canCreate && (
            <Button
              variant="primary"
              startIcon={<Icon name="plus" size={16} />}
              onClick={() => setCreating({ parentId: null })}
              data-testid="org-unit-create-button"
            >
              {t('organization.create.topLevelAction')}
            </Button>
          )}
        </div>
      </header>

      <Tabs
        moreLabel={t('common.more')}
        value={view}
        onValueChange={changeView}
        tabs={[
          { value: 'list', label: t('organization.view.list') },
          { value: 'chart', label: t('organization.view.chart') },
        ]}
        data-testid="organization-view"
      />

      {view === 'chart' ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <OrgChartPanel
            units={tree.data?.items}
            loading={tree.isPending}
            error={tree.error}
            onRetry={() => void tree.refetch()}
            selectedId={unitId}
            onSelect={select}
            permission={permission}
            detail={detail}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          <OrgUnitTreePanel
            units={tree.data?.items}
            loading={tree.isPending}
            error={tree.error}
            onRetry={() => void tree.refetch()}
            selectedId={unitId}
            onSelect={select}
          />
          <div className="min-w-0 flex-1 overflow-auto">
            {detail ?? (
              <Empty
                title={t('organization.detail.emptyTitle')}
                description={t('organization.detail.emptyDescription')}
                data-testid="org-unit-detail-empty"
              />
            )}
          </div>
        </div>
      )}

      <OrgUnitCreateDialog
        target={creating}
        onClose={() => setCreating(undefined)}
        onCreated={(unit) => select(unit.id)}
      />
      <OrgUnitMoveDialog
        unit={moving}
        units={tree.data?.items}
        onClose={() => setMoving(undefined)}
      />
      <ExportDialog
        open={exporting !== null}
        onOpenChange={(open) => !open && setExporting(null)}
        api={orgUnitExportApi}
        type={exporting ?? 'orgUnit'}
        filter={
          exporting === 'orgUnitMember' && unitId ? { unitId, includeDescendants: 'true' } : {}
        }
        matchingTotal={exporting === 'orgUnit' ? tree.data?.items.length : undefined}
        data-testid="org-unit-export-dialog"
      />

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(undefined)}
        title={t('organization.delete.title')}
        // 成員資格隨部門休眠；還有下層部門時後端回 409，錯誤以 toast 顯示
        description={t('organization.delete.confirm', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        loading={deleteUnit.isPending}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteUnit.mutateAsync({ params: { unitId: pendingDelete.id } });
          } catch {
            // 錯誤由 mutation 的 onError 顯示；對話框留著讓使用者取消
            return;
          }
          // 刪掉的部門不在樹上了：改選它的上層
          select(pendingDelete.parentId ?? undefined);
          setPendingDelete(undefined);
        }}
        data-testid="org-unit-delete-confirm"
      />
    </div>
  );
}
