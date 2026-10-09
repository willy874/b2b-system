import type { ApprovalFlow } from '@/shared/api-sdk';

import type { FlowDraft } from '../../hooks/flowDraft';

/**
 * 儲存前要讓人知道的影響（docs/architecture/backend/20-approval.md §9.5、§9.16）：送出時已複製關卡的請求照舊、
 * 啟用或停用會改變新申請怎麼審。沒有任何影響時回空陣列，不必確認。
 */
export function saveImpacts(
  item: ApprovalFlow,
  draft: FlowDraft,
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] {
  const impacts: string[] = [];
  const wasEnabled = item.flow?.enabled ?? false;
  if (item.inFlightCount > 0) {
    impacts.push(t('approvalFlow.save.impact.inFlight', { count: item.inFlightCount }));
  }
  if (wasEnabled && !draft.enabled) impacts.push(t('approvalFlow.save.impact.disable'));
  if (!wasEnabled && draft.enabled) impacts.push(t('approvalFlow.save.impact.enable'));
  return impacts;
}
