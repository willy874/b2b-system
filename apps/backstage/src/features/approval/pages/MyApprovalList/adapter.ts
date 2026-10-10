import type { ApprovalListParams } from '@/apis/approval/types';
import type { ApprovalRequest } from '@/shared/api-sdk';

import type { MyApprovalTab } from '../../constants';
import type { MyApprovalSearchQuery } from '../../routes';

export interface MyApprovalRowVM {
  id: string;
  type: ApprovalRequest['type'];
  status: ApprovalRequest['status'];
  requesterName: string;
  createdAt: Date;
  /** 多階段的進度；單關或已結束為 null。 */
  progress: ApprovalRequest['currentStep'];
  stepCount: number;
}

/**
 * `chainEnabled`：多階段已啟用（`approvalChain` 已安裝）。停用期間進行中的多關請求以單關定案，
 * 不顯示關卡的進度（docs/architecture/backend/20-approval.md §9.11）。
 */
export function toMyApprovalRowVM(dto: ApprovalRequest, chainEnabled: boolean): MyApprovalRowVM {
  return {
    id: dto.id,
    type: dto.type,
    status: dto.status,
    requesterName: dto.requesterName,
    createdAt: new Date(dto.createdAt),
    progress: chainEnabled ? dto.currentStep : null,
    stepCount: chainEnabled ? dto.stepCount : 0,
  };
}

/**
 * 「我的審批」的查詢參數（列表、詳情的「下一筆」、首頁的待辦共用同一個順序）：「待我審核」是待辦，最早送出的在前；
 * 「我的申請」最新的在前（後端預設）。
 */
export function toMyApprovalListParams(
  search: Pick<MyApprovalSearchQuery, 'offset' | 'limit'>,
  tab: MyApprovalTab,
): ApprovalListParams {
  return {
    scope: tab,
    offset: search.offset,
    limit: search.limit,
    sort: tab === 'assigned' ? [{ sort: 'createdAt', order: 'asc' }] : [],
  };
}
