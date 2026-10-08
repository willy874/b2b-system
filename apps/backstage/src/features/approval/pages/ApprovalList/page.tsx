import { useTableSelection } from '@b2b-system/ui/Table';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { fetchApprovalListQuery } from '@/apis/approval/get-approval-list/fetcher';
import { getApprovalListQueryOptions } from '@/apis/approval/get-approval-list/query';
import { useIsFeatureReady } from '@/core/feature';

import { APPROVAL_CHAIN_FEATURE } from '../../constants';
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
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('approval.list.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('approval.list.description')}
        </p>
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
          actions: batchActions,
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

      <Outlet />
    </div>
  );
}

const getRowId = (row: ApprovalRowVM) => row.id;
const getRowLabel = (row: ApprovalRowVM) => row.requesterName;
