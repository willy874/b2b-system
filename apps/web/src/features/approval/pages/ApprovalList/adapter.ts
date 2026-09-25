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
}

/** adapter 是後端契約變動的緩衝層：欄位改名時只有這裡要改。 */
export function toApprovalRowVM(dto: ApprovalRequest): ApprovalRowVM {
  return {
    id: dto.id,
    type: dto.type,
    status: dto.status,
    requesterName: dto.requesterName,
    reviewerName: dto.reviewerName,
    createdAt: new Date(dto.createdAt),
    reviewedAt: dto.reviewedAt ? new Date(dto.reviewedAt) : null,
    isPending: dto.status === 'pending',
  };
}
