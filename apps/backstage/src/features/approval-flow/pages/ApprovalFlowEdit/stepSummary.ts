import { ASSIGNEE_KIND_LABEL_KEY } from '../../constants';
import { savedAssigneeStatus } from '../../hooks/flowDraft';
import type { StepDraft } from '../../hooks/flowDraft';

/**
 * 關卡收合時與流程摘要上的一句話（docs/architecture/backend/20-approval.md §9.16）：「指定使用者：王小明 · 1 人 · 1 個條件」。
 * 規則在這次編輯中改過（還沒儲存）時，對象的名稱不在草稿裡，只寫種類。
 */
export function stepSummaryParts(
  step: StepDraft,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const kind = t(ASSIGNEE_KIND_LABEL_KEY[step.assignee.kind]);
  const label = savedAssigneeStatus(step)?.label;
  const assignee =
    step.assignee.kind === 'manager'
      ? t('approvalFlow.assignee.managerLevel', { level: step.assignee.level })
      : label
        ? t('approvalFlow.assignee.summary', { kind, target: label })
        : kind;
  const required =
    step.requiredMode === 'all'
      ? t('approvalFlow.summary.requiredAll')
      : t('approvalFlow.summary.requiredCount', { count: step.requiredCount });
  const conditions =
    step.conditions.length > 0
      ? t('approvalFlow.summary.conditions', { count: step.conditions.length })
      : undefined;
  return { assignee, required, conditions };
}
