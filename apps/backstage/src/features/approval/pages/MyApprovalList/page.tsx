import { PageHeader } from '@b2b-system/ui/PageHeader';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { Tabs } from '@b2b-system/ui/Tabs';
import { RichTable } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useRouteSearch } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { getApprovalListQueryOptions } from '@/apis/approval/get-approval-list/query';
import { useIsFeatureReady } from '@/core/feature';

import { approvalColumns } from '../../components/approvalColumns';
import {
  APPROVAL_CHAIN_FEATURE,
  MY_APPROVAL_TAB_LABEL_KEY,
  MY_APPROVAL_TABS,
} from '../../constants';
import type { MyApprovalTab } from '../../constants';
import { useApprovalCounts } from '../../hooks/useApprovalCounts';
import { MyApprovalDetailRoute, MyApprovalRoute } from '../../routes';
import type { MyApprovalSearchQuery } from '../../routes';
import { toMyApprovalListParams, toMyApprovalRowVM } from './adapter';
import type { MyApprovalRowVM } from './adapter';

/**
 * 「我的審批」（docs/architecture/backend/20-approval.md §9.10、§9.16）：待我審核（多階段關卡的審核者）與我送出的申請。
 * 「待我審核」只在多階段已啟用時出現；停用期間那些請求改由審批管理者一次定案（§9.11）。
 */
export default function MyApprovalListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { search, patch } = useRouteSearch<MyApprovalSearchQuery>(MyApprovalRoute);
  const chainEnabled = useIsFeatureReady(APPROVAL_CHAIN_FEATURE);
  const tabs: MyApprovalTab[] = chainEnabled ? ['assigned', 'mine'] : ['mine'];
  const tab: MyApprovalTab =
    search.tab && tabs.includes(search.tab) ? search.tab : (tabs[0] ?? 'mine');

  const { data, isPending, error, refetch } = useQuery(
    getApprovalListQueryOptions({ params: toMyApprovalListParams(search, tab) }),
  );
  const rows = useMemo(
    () => (data?.items ?? []).map((item) => toMyApprovalRowVM(item, chainEnabled)),
    [data, chainEnabled],
  );
  const assignedCount = useApprovalCounts()?.assigned ?? 0;
  // 從「待我審核」點進詳情：決定後前往下一筆（docs/architecture/backend/20-approval.md §12 D5）
  const detailSearch = useMemo(
    () => ({ ...search, tab, queue: tab === 'assigned' || undefined }),
    [search, tab],
  );

  const columns = useMemo<Array<TableColumnDef<MyApprovalRowVM>>>(() => {
    const shared = approvalColumns<MyApprovalRowVM>({
      t,
      renderTypeLink: (row, label) => (
        <Link
          to={MyApprovalDetailRoute.to}
          params={{ approvalId: row.id }}
          search={detailSearch}
          className="font-medium whitespace-nowrap text-[var(--color-brand)]"
          data-testid="my-approval-detail-link"
          data-value={row.requesterName}
        >
          {label}
        </Link>
      ),
      statusTestId: 'my-approval-status',
    });
    return [shared.type, shared.requesterName, shared.progress, shared.status, shared.createdAt];
  }, [detailSearch, t]);

  const setSearch = (next: { tab?: MyApprovalTab; offset?: number; limit?: number }) => patch(next);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="my-approval-page">
      <PageHeader title={t('menu.myApproval')} description={t('approval.my.description')} />

      <Tabs
        value={tab}
        onValueChange={(value) => setSearch({ tab: toTab(value), offset: 0 })}
        tabs={tabs.map((value) => ({
          value,
          label:
            value === 'assigned' && assignedCount > 0
              ? t('approval.my.assignedTab', { count: assignedCount })
              : t(MY_APPROVAL_TAB_LABEL_KEY[value]),
          textValue: t(MY_APPROVAL_TAB_LABEL_KEY[value]),
        }))}
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
          void navigate({
            to: MyApprovalDetailRoute.to,
            params: { approvalId: row.id },
            search: detailSearch,
          })
        }
        emptyTitle={t(tab === 'assigned' ? 'approval.my.emptyAssigned' : 'approval.my.emptyMine')}
        emptyDescription={t(
          tab === 'assigned' ? 'approval.my.emptyAssignedHint' : 'approval.my.emptyMineHint',
        )}
        data-testid="my-approval-table"
      />
    </div>
  );
}

const getRowId = (row: MyApprovalRowVM) => row.id;

const toTab = (value: string): MyApprovalTab =>
  MY_APPROVAL_TABS.find((tab) => tab === value) ?? 'mine';
