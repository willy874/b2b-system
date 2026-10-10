import { registerBatchOperation } from '@b2b-system/web-core/batch';

import { APPROVAL_LOCALE_SCOPE } from './locale';

/** 審批列表的批次操作 id（`BatchAction.operation`）。 */
export const ApprovalBatchOperation = {
  APPROVE: 'approval.approve',
  REJECT: 'approval.reject',
} as const;

/** 實作在第一次執行時才載入（docs/architecture/frontend/02-plugin-system.md §4.8）。 */
const runs = () => import('./batchRuns');

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
    run: async (approvalId, context) => (await runs()).approveRun(approvalId, context),
  });
  registerBatchOperation({
    id: ApprovalBatchOperation.REJECT,
    labelKey: 'approval.batch.reject.title',
    localeScope: APPROVAL_LOCALE_SCOPE,
    successKey: 'approval.batch.reject.success',
    run: async (approvalId, context) => (await runs()).rejectRun(approvalId, context),
  });
}
