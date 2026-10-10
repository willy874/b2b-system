import type { BatchRunContext } from '@b2b-system/web-core/batch';

import { getApproveApprovalMutationOptions } from '@/apis/approval/approve-approval/mutation';
import { getRejectApprovalMutationOptions } from '@/apis/approval/reject-approval/mutation';
import { Resource } from '@/apis/resources';

import { approvalReviewedChanges } from './hooks/useApprovalMutations';

/**
 * 審批批次操作的實作：`batch.ts` 在第一次執行時才以 `import()` 載入（docs/architecture/frontend/02-plugin-system.md §4.8）。
 * 語意同列上的快速核准／駁回：不指派角色、不附意見。
 */
const approve = getApproveApprovalMutationOptions().mutationFn;
const reject = getRejectApprovalMutationOptions().mutationFn;

export async function approveRun(
  approvalId: string,
  { invalidate }: BatchRunContext,
): Promise<void> {
  const approval = await approve({ params: { approvalId, body: { roleIds: [] } } });
  invalidate(approvalReviewedChanges(approval, []));
}

export async function rejectRun(
  approvalId: string,
  { invalidate }: BatchRunContext,
): Promise<void> {
  const approval = await reject({ params: { approvalId, body: {} } });
  invalidate([{ resource: Resource.APPROVAL, kind: 'update', id: approval.id }]);
}
