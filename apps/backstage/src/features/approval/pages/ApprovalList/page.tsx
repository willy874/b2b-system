import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { getApprovalListQueryOptions } from '@/apis/approval/get-approval-list/query';
import { useTableSelection } from '@/components/Table';
import { useTranslation } from '@/core/locales';

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

  const { data, isPending } = useQuery(
    getApprovalListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        keyword: search.keyword,
        status: search.status ? [search.status] : undefined,
        type: search.type ? [search.type] : undefined,
        sort: search.sort,
      },
    }),
  );

  const rows = useMemo(
    () => (data?.items ?? []).map((item) => toApprovalRowVM(item, permission)),
    [data, permission],
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
        search={search}
        onSortingChange={setSort}
        onRowDoubleClick={(row) =>
          void navigate({ to: ApprovalDetailRoute.to, params: { approvalId: row.id }, search })
        }
        filters={filters}
        batch={{ scope: APPROVAL_LIST_TABLE_ID, selection, actions: batchActions, getRowLabel }}
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
