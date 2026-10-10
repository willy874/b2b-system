import type { ApprovalListParams } from '@/apis/approval/types';
import type { ApprovalRequest } from '@/shared/api-sdk';

import type { ApprovalSearchQuery } from '../../routes';

export interface ApprovalRowVM {
  id: string;
  type: ApprovalRequest['type'];
  status: ApprovalRequest['status'];
  requesterName: string;
  reviewerName: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  isPending: boolean;
  /** 多階段的進度（目前的關卡與同意數）；單關或已結束為 null（docs/architecture/backend/20-approval.md §9.16）。 */
  progress: ApprovalRequest['currentStep'];
  /** 關卡總數（含略過的）；單關為 0。 */
  stepCount: number;
  /** 列上顯示快速審核（核准／駁回）：待審且有 `approval:review`；多關請求要在關卡上決定，不能快速審核 */
  canReview: boolean;
  /** 快速核准可用：另需該類型要求的權限（註冊 = `user:create`） */
  canApprove: boolean;
}

export interface ApprovalPermissionFacade {
  canReview: boolean;
  canApproveRegistration: boolean;
  /**
   * 多階段已啟用（`approvalChain` 已安裝）：進行中的多關請求只能在關卡上決定。
   * 停用期間它們改由單關的核准／駁回一次定案（docs/architecture/backend/20-approval.md §9.11、D12）。
   */
  chainEnabled: boolean;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toApprovalRowVM(
  dto: ApprovalRequest,
  permission: ApprovalPermissionFacade,
): ApprovalRowVM {
  const isPending = dto.status === 'pending';
  const inChain = isPending && dto.currentStep !== null;
  const canReview = isPending && permission.canReview && !(inChain && permission.chainEnabled);
  return {
    id: dto.id,
    type: dto.type,
    status: dto.status,
    requesterName: dto.requesterName,
    reviewerName: dto.reviewerName,
    createdAt: new Date(dto.createdAt),
    reviewedAt: dto.reviewedAt ? new Date(dto.reviewedAt) : null,
    isPending,
    // 停用期間進行中的多關請求就是一筆單關的申請，不顯示關卡的進度與短缺（§9.11）
    progress: permission.chainEnabled ? dto.currentStep : null,
    stepCount: permission.chainEnabled ? dto.stepCount : 0,
    canReview,
    canApprove: canReview && (dto.type !== 'user.register' || permission.canApproveRegistration),
  };
}

/** 網址的條件 → 列表的查詢參數（列表頁與詳情的「下一筆」共用，兩邊才會是同一份清單）。 */
export function toApprovalListParams(search: ApprovalSearchQuery): ApprovalListParams {
  return {
    offset: search.offset,
    limit: search.limit,
    keyword: search.keyword,
    status: search.status === 'all' ? undefined : [search.status],
    type: search.type ? [search.type] : undefined,
    sort: search.sort,
  };
}
