import { Chip } from '@b2b-system/ui/Chip';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';

import { getApprovalFlowStatsQueryOptions } from '@/apis/approval-flow/get-approval-flow-stats/query';

/**
 * 卡片上的一行實際運作（docs/architecture/backend/20-approval.md §9.16）：近 30 天送出幾筆、目前進行中幾筆，
 * 有找不到審核者的請求時標示。還沒有任何申請時不顯示。
 */
export function FlowStatsLine({ type }: { type: string }) {
  const { t } = useTranslation();
  const { data } = useQuery(getApprovalFlowStatsQueryOptions(type));
  if (!data || (data.submitted === 0 && data.pending === 0)) return null;
  const shortage = data.currentSteps.reduce((sum, step) => sum + step.shortage, 0);
  return (
    <p
      className="m-0 flex flex-wrap items-center gap-2 text-sm text-[var(--color-fg-muted)]"
      data-testid="approval-flow-stats-line"
    >
      {t('approvalFlow.stats.line', {
        days: data.days,
        submitted: data.submitted,
        pending: data.pending,
      })}
      {shortage > 0 && (
        <Chip tone="danger" data-testid="approval-flow-stats-line-shortage">
          {t('approvalFlow.stats.shortage', { count: shortage })}
        </Chip>
      )}
    </p>
  );
}
