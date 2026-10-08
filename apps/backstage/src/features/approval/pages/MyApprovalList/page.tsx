import { Chip } from '@b2b-system/ui/Chip';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Tabs } from '@b2b-system/ui/Tabs';
import { RichTable } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { getApprovalListQueryOptions } from '@/apis/approval/get-approval-list/query';
import { useIsFeatureReady } from '@/core/feature';

import {
  APPROVAL_CHAIN_FEATURE,
  APPROVAL_STATUS_LABEL_KEY,
  APPROVAL_STATUS_TONE,
  APPROVAL_TYPE_LABEL_KEY,
  MY_APPROVAL_TAB_LABEL_KEY,
  MY_APPROVAL_TABS,
} from '../../constants';
import type { MyApprovalTab } from '../../constants';
import { MyApprovalDetailRoute, MyApprovalRoute } from '../../routes';
import { ApprovalProgress } from '../ApprovalList/components/ApprovalProgress';
import { toMyApprovalRowVM } from './adapter';
import type { MyApprovalRowVM } from './adapter';

/**
 * 「我的審批」（docs/architecture/backend/20-approval.md §9.10、§9.16）：待我審核（多階段關卡的審核者）與我送出的申請。
 * 「待我審核」只在多階段已啟用時出現；停用期間那些請求改由審批管理者一次定案（§9.11）。
 */
export default function MyApprovalListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = MyApprovalRoute.useSearch();
  const chainEnabled = useIsFeatureReady(APPROVAL_CHAIN_FEATURE);
  const tabs: MyApprovalTab[] = chainEnabled ? ['assigned', 'mine'] : ['mine'];
  const tab: MyApprovalTab =
    search.tab && tabs.includes(search.tab) ? search.tab : (tabs[0] ?? 'mine');

  const { data, isPending, error, refetch } = useQuery(
    getApprovalListQueryOptions({
      params: { scope: tab, offset: search.offset, limit: search.limit },
    }),
  );
  const rows = useMemo(() => (data?.items ?? []).map(toMyApprovalRowVM), [data]);

  const columns = useMemo<Array<TableColumnDef<MyApprovalRowVM>>>(
    () => [
      {
        id: 'type',
        header: t('approval.field.type'),
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={MyApprovalDetailRoute.to}
            params={{ approvalId: row.original.id }}
            search={search}
            className="font-medium whitespace-nowrap text-[var(--color-brand)]"
            data-testid="my-approval-detail-link"
            data-value={row.original.requesterName}
          >
            {t(APPROVAL_TYPE_LABEL_KEY[row.original.type])}
          </Link>
        ),
      },
      {
        id: 'requesterName',
        header: t('approval.field.requester'),
        enableSorting: false,
        cell: ({ row }) => row.original.requesterName,
      },
      {
        id: 'progress',
        header: t('approval.field.progress'),
        enableSorting: false,
        cell: ({ row }) => <ApprovalProgress row={row.original} />,
      },
      {
        id: 'status',
        header: t('approval.field.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <Chip
            tone={APPROVAL_STATUS_TONE[row.original.status]}
            data-testid="my-approval-status"
            data-value={row.original.status}
          >
            {t(APPROVAL_STATUS_LABEL_KEY[row.original.status])}
          </Chip>
        ),
      },
      {
        id: 'createdAt',
        header: t('approval.field.createdAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
    ],
    [search, t],
  );

  const setSearch = (next: { tab?: MyApprovalTab; offset?: number; limit?: number }) =>
    void navigate({ to: MyApprovalRoute.to, search: { ...search, ...next } });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="my-approval-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('menu.myApproval')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('approval.my.description')}</p>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => setSearch({ tab: toTab(value), offset: 0 })}
        tabs={tabs.map((value) => ({ value, label: t(MY_APPROVAL_TAB_LABEL_KEY[value]) }))}
        moreLabel={t('common.more')}
        data-testid="my-approval-tabs"
      />

      <RichTable
        data={rows}
        columns={columns}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        getRowId={getRowId}
        pagination={{
          offset: search.offset,
          limit: search.limit,
          total: data?.pagination.total ?? 0,
          onChange: ({ offset, limit }) => setSearch({ offset, limit }),
        }}
        onRowDoubleClick={(row) =>
          void navigate({ to: MyApprovalDetailRoute.to, params: { approvalId: row.id }, search })
        }
        emptyTitle={t(tab === 'assigned' ? 'approval.my.emptyAssigned' : 'approval.my.emptyMine')}
        data-testid="my-approval-table"
      />

      <Outlet />
    </div>
  );
}

const getRowId = (row: MyApprovalRowVM) => row.id;

const toTab = (value: string): MyApprovalTab =>
  MY_APPROVAL_TABS.find((tab) => tab === value) ?? 'mine';
