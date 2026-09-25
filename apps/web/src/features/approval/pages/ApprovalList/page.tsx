import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { getApprovalListQueryOptions } from '@/apis/approval/get-approval-list/query';
import { useTranslation } from '@/core/locales';

import { useApprovalPermission } from '../../hooks/useApprovalPermission';
import { ApprovalDetailRoute } from '../../routes';
import { toApprovalRowVM } from './adapter';
import { ApprovalTable } from './components/ApprovalTable';
import { useApprovalFilters } from './useApprovalFilters';
import { useApprovalSearchFilter } from './useApprovalSearchFilter';

export default function ApprovalListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const searchFilter = useApprovalSearchFilter();
  const { search, setSort, setPage } = searchFilter;
  const filters = useApprovalFilters(searchFilter);
  const permission = useApprovalPermission();

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

  return (
    <div className="flex flex-col gap-4" data-testid="approval-list-page">
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
