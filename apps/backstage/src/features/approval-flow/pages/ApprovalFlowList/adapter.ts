import type { ApprovalFlow } from '@/shared/api-sdk';

import type { ApprovalFlowStatus } from '../../constants';

export interface ApprovalFlowCardVM {
  type: string;
  status: ApprovalFlowStatus;
  /** 關卡名稱依序；還沒設定流程時是空陣列。停用的流程仍保留設定，照樣列出。 */
  stepNames: string[];
  /** 有關卡的規則現在不能用或指到已刪除的對象（提示管理者去處理）。 */
  hasAssigneeIssue: boolean;
  version: number | null;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toApprovalFlowCardVM(dto: ApprovalFlow): ApprovalFlowCardVM {
  const flow = dto.flow;
  return {
    type: dto.type,
    status: !flow ? 'unset' : flow.enabled ? 'enabled' : 'disabled',
    stepNames: flow?.steps.map((step) => step.name) ?? [],
    hasAssigneeIssue:
      flow?.steps.some((step) => !step.assigneeStatus.available || step.assigneeStatus.deleted) ??
      false,
    version: flow?.version ?? null,
  };
}
