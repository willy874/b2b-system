import type { ApprovalRequest } from '@/shared/api-sdk';

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
    progress: dto.currentStep,
    stepCount: dto.stepCount,
    canReview,
    canApprove: canReview && (dto.type !== 'user.register' || permission.canApproveRegistration),
  };
}
