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
  /** 列上顯示快速審核（核准／駁回）：待審且有 `approval:review` */
  canReview: boolean;
  /** 快速核准可用：另需該類型要求的權限（註冊 = `user:create`） */
  canApprove: boolean;
}

export interface ApprovalPermissionFacade {
  canReview: boolean;
  canApproveRegistration: boolean;
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toApprovalRowVM(
  dto: ApprovalRequest,
  permission: ApprovalPermissionFacade,
): ApprovalRowVM {
  const isPending = dto.status === 'pending';
  const canReview = isPending && permission.canReview;
  return {
    id: dto.id,
    type: dto.type,
    status: dto.status,
    requesterName: dto.requesterName,
    reviewerName: dto.reviewerName,
    createdAt: new Date(dto.createdAt),
    reviewedAt: dto.reviewedAt ? new Date(dto.reviewedAt) : null,
    isPending,
    canReview,
    canApprove: canReview && (dto.type !== 'user.register' || permission.canApproveRegistration),
  };
}
