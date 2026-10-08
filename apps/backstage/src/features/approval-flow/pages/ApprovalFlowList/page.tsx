import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { getApprovalFlowListQueryOptions } from '@/apis/approval-flow/get-approval-flow-list/query';

import { ApprovalFlowEditRoute } from '../../routes';
import { toApprovalFlowRowVM } from './adapter';
import { ApprovalFlowTable } from './components/ApprovalFlowTable';

/** 支援多階段流程的審批類型（docs/architecture/backend/20-approval.md §9.16）：流程狀態與關卡摘要，點進去編輯。 */
export default function ApprovalFlowListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isPending, error, refetch } = useQuery(getApprovalFlowListQueryOptions());
  const rows = useMemo(() => (data?.items ?? []).map(toApprovalFlowRowVM), [data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="approval-flow-list-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('approvalFlow.list.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('approvalFlow.list.description')}
        </p>
      </header>
      <ApprovalFlowTable
        rows={rows}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        onRowDoubleClick={(row) =>
          void navigate({ to: ApprovalFlowEditRoute.to, params: { type: row.type } })
        }
      />
    </div>
  );
}
