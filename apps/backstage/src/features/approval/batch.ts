import { registerBatchOperation } from '@b2b-system/web-core/batch';

import { getApproveApprovalMutationOptions } from '@/apis/approval/approve-approval/mutation';
import { getRejectApprovalMutationOptions } from '@/apis/approval/reject-approval/mutation';
import { Resource } from '@/apis/resources';

import { approvalReviewedChanges } from './hooks/useApprovalMutations';
import { APPROVAL_LOCALE_SCOPE } from './locale';

/** 審批列表的批次操作 id（`BatchAction.operation`）。 */
export const ApprovalBatchOperation = {
  APPROVE: 'approval.approve',
  REJECT: 'approval.reject',
} as const;

const approve = getApproveApprovalMutationOptions().mutationFn;
const reject = getRejectApprovalMutationOptions().mutationFn;

/**
 * 在 plugin 的同步階段呼叫。語意同列上的快速核准／駁回：不指派角色、不附意見；
 * 要指派角色請開審核對話框逐筆審。
 */
export function registerApprovalBatchOperations(): void {
  registerBatchOperation({
    id: ApprovalBatchOperation.APPROVE,
    labelKey: 'approval.batch.approve.title',
    localeScope: APPROVAL_LOCALE_SCOPE,
    successKey: 'approval.batch.approve.success',
    run: async (approvalId, { invalidate }) => {
      const approval = await approve({ params: { approvalId, body: { roleIds: [] } } });
      invalidate(approvalReviewedChanges(approval, []));
    },
  });
  registerBatchOperation({
    id: ApprovalBatchOperation.REJECT,
    labelKey: 'approval.batch.reject.title',
    localeScope: APPROVAL_LOCALE_SCOPE,
    successKey: 'approval.batch.reject.success',
    run: async (approvalId, { invalidate }) => {
      const approval = await reject({ params: { approvalId, body: {} } });
      invalidate([{ resource: Resource.APPROVAL, kind: 'update', id: approval.id }]);
    },
  });
}
