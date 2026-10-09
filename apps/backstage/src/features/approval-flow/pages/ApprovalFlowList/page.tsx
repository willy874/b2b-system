import { Empty } from '@b2b-system/ui/Empty';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getApprovalFlowListQueryOptions } from '@/apis/approval-flow/get-approval-flow-list/query';
import { SystemSettingsLayout } from '@/core/system-settings';

import { useApprovalFlowPermission } from '../../hooks/useApprovalFlowPermission';
import { toApprovalFlowCardVM } from './adapter';
import { ApprovalFlowCard } from './components/ApprovalFlowCard';

/**
 * 系統設定的「審批流程」分頁（docs/architecture/backend/20-approval.md §9.16）：
 * 每一種支援多階段流程的審批類型一張卡片，寫明目前怎麼審（單關或依序的關卡），點進去設定。
 */
export default function ApprovalFlowListPage() {
  const { t } = useTranslation();
  const permission = useApprovalFlowPermission();
  const { data, isPending, error, refetch } = useQuery(getApprovalFlowListQueryOptions());
  const cards = useMemo(() => (data?.items ?? []).map(toApprovalFlowCardVM), [data]);
  // 權限未水合前按鈕先顯示「檢視」，不閃現「設定」
  const canUpdate = permission.hydrated && permission.canUpdate;

  return (
    <SystemSettingsLayout>
      <div className="flex max-w-4xl flex-col gap-4" data-testid="approval-flow-list-page">
        <div className="flex flex-col gap-1 text-sm text-[var(--color-fg-muted)]">
          <p className="m-0">{t('approvalFlow.list.description')}</p>
          <p className="m-0">{t('approvalFlow.list.scope')}</p>
        </div>
        {isPending ? (
          <Skeleton className="h-40" />
        ) : error && !data ? (
          <QueryError
            error={error}
            onRetry={() => void refetch()}
            data-testid="approval-flow-list-error"
          />
        ) : cards.length === 0 ? (
          <Empty title={t('approvalFlow.list.empty')} data-testid="approval-flow-list-empty" />
        ) : (
          cards.map((card) => (
            <ApprovalFlowCard key={card.type} card={card} canUpdate={canUpdate} />
          ))
        )}
      </div>
    </SystemSettingsLayout>
  );
}
