import type { ApprovalFlow } from '@/shared/api-sdk';

import type { ApprovalFlowStatus } from '../../constants';

export interface ApprovalFlowRowVM {
  type: string;
  status: ApprovalFlowStatus;
  /** 關卡名稱依序；還沒設定流程時是空陣列。 */
  stepNames: string[];
  /** 有關卡的規則現在不能用或指到已刪除的對象（列表上提示管理者去處理）。 */
  hasAssigneeIssue: boolean;
  version: number | null;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toApprovalFlowRowVM(dto: ApprovalFlow): ApprovalFlowRowVM {
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
