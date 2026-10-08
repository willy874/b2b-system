import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Menu } from '@b2b-system/ui/Menu';
import { useTableSelection } from '@b2b-system/ui/Table';
import type { BatchAction } from '@b2b-system/web-core/batch';
import { ExportDialog } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { fetchApprovalListQuery } from '@/apis/approval/get-approval-list/fetcher';
import { getApprovalListQueryOptions } from '@/apis/approval/get-approval-list/query';
import { useIsFeatureReady } from '@/core/feature';

import { APPROVAL_CHAIN_FEATURE } from '../../constants';
import { approvalExportApi } from '../../hooks/approvalExportApi';
import { useApprovalPermission } from '../../hooks/useApprovalPermission';
import { APPROVAL_LIST_TABLE_ID } from '../../preference';
import { ApprovalDetailRoute } from '../../routes';
import { toApprovalRowVM } from './adapter';
import type { ApprovalRowVM } from './adapter';
import { ApprovalTable } from './components/ApprovalTable';
import { useApprovalBatchActions } from './useApprovalBatchActions';
import { useApprovalFilters } from './useApprovalFilters';
import { useApprovalSearchFilter } from './useApprovalSearchFilter';

export default function ApprovalListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const searchFilter = useApprovalSearchFilter();
  const { search, setSort, setPage } = searchFilter;
  const permission = useApprovalPermission();
  const batchActions = useApprovalBatchActions();
  /** 匯出對話框：請求或審核紀錄，以及開啟時勾選的範圍（docs/architecture/backend/22-data-transfer.md §12.5）。 */
  const [exporting, setExporting] = useState<{
    type: 'approvalRequest' | 'approvalDecision';
    ids: string[];
    allMatching: boolean;
  } | null>(null);

  const listParams = {
    offset: search.offset,
    limit: search.limit,
    keyword: search.keyword,
    status: search.status ? [search.status] : undefined,
    type: search.type ? [search.type] : undefined,
    sort: search.sort,
  };
  const { data, isPending, error, refetch } = useQuery(
    getApprovalListQueryOptions({ params: listParams }),
  );

  // 只依賴 adapter 用到的布林值：與資料、這幾個條件無關的重繪不重建列
  const { canReview, canApproveRegistration } = permission;
  const chainEnabled = useIsFeatureReady(APPROVAL_CHAIN_FEATURE);
  const facade = useMemo(
    () => ({ canReview, canApproveRegistration, chainEnabled }),
    [canReview, canApproveRegistration, chainEnabled],
  );
  const rows = useMemo(
    () => (data?.items ?? []).map((item) => toApprovalRowVM(item, facade)),
    [data, facade],
  );
  const selection = useTableSelection(rows, getRowId);
  // 批次列的「匯出選取」：勾選的請求（與它們的審核紀錄）
  const actions = useMemo<Array<BatchAction<ApprovalRowVM>>>(
    () => [
      ...batchActions,
      {
        kind: 'run',
        id: 'export',
        label: t('dataTransfer.export.selectedAction'),
        hidden: !permission.hydrated || !permission.canExport,
        run: ({ rows: targets, allMatching }) =>
          setExporting({
            type: 'approvalRequest',
            ids: targets.map((target) => target.id),
            allMatching,
          }),
      },
    ],
    [batchActions, permission.canExport, permission.hydrated, t],
  );
  // 篩選條件改變後，原本勾選的列可能不在結果裡了：清空選取（排序只是換順序，保留）
  const filters = useApprovalFilters({
    ...searchFilter,
    setFilters: (next) => {
      if (
        next.keyword !== search.keyword ||
        next.status !== search.status ||
        next.type !== search.type
      ) {
        selection.clear();
      }
      searchFilter.setFilters(next);
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="approval-list-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('approval.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {t('approval.list.description')}
          </p>
        </div>
        {permission.canExport && (
          <Menu
            align="end"
            trigger={
              <Button
                variant="secondary"
                startIcon={<Icon name="download" size={16} />}
                endIcon={<Icon name="chevron-down" size={14} />}
                data-testid="approval-export-button"
              >
                {t('dataTransfer.export.action')}
              </Button>
            }
            items={[
              {
                key: 'approvalRequest',
                label: t('approval.transfer.requests'),
                onSelect: () =>
                  setExporting({ type: 'approvalRequest', ids: [], allMatching: false }),
              },
              {
                key: 'approvalDecision',
                label: t('approval.transfer.decisions'),
                onSelect: () =>
                  setExporting({ type: 'approvalDecision', ids: [], allMatching: false }),
              },
            ]}
            data-testid="approval-export-menu"
          />
        )}
      </header>

      <ApprovalTable
        rows={rows}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        search={search}
        onSortingChange={setSort}
        onRowDoubleClick={(row) =>
          void navigate({ to: ApprovalDetailRoute.to, params: { approvalId: row.id }, search })
        }
        filters={filters}
        batch={{
          scope: APPROVAL_LIST_TABLE_ID,
          selection,
          actions,
          getRowLabel,
          // 「選取全部符合」：同樣的篩選與排序逐頁取回（docs/architecture/frontend/07-ui-system.md §13.7）
          selectAllMatching: {
            total: data?.pagination.total ?? 0,
            fetchPage: async (offset, limit, signal) => {
              const page = await fetchApprovalListQuery({
                params: { ...listParams, offset, limit },
                signal,
              });
              return {
                items: page.items.map((item) => toApprovalRowVM(item, facade)),
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
        api={approvalExportApi}
        type={exporting?.type ?? 'approvalRequest'}
        selectedIds={exporting?.ids}
        allMatchingSelected={exporting?.allMatching}
        filter={{ keyword: listParams.keyword, status: listParams.status, type: listParams.type }}
        matchingTotal={
          exporting?.type === 'approvalDecision' ? undefined : (data?.pagination.total ?? 0)
        }
        data-testid="approval-export-dialog"
      />

      <Outlet />
    </div>
  );
}

const getRowId = (row: ApprovalRowVM) => row.id;
const getRowLabel = (row: ApprovalRowVM) => row.requesterName;
