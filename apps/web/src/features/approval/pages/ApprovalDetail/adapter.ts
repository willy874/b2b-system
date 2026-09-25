import type { ApprovalRequest } from '@/shared/api-sdk';

/** `user.register` 的申請內容。 */
export interface RegistrationVM {
  email: string;
  displayName: string;
}

export interface ApprovalDetailVM {
  id: string;
  type: ApprovalRequest['type'];
  status: ApprovalRequest['status'];
  isPending: boolean;
  requesterName: string;
  reason: string | null;
  createdAt: Date;
  reviewerName: string | null;
  reviewComment: string | null;
  reviewedAt: Date | null;
  /** `type = user.register` 時才有 */
  registration: RegistrationVM | null;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** `payload` 依類型而定，後端型別是 `Record<string, unknown>`：在這裡收斂成畫面要的形狀。 */
export function toApprovalDetailVM(dto: ApprovalRequest): ApprovalDetailVM {
  return {
    id: dto.id,
    type: dto.type,
    status: dto.status,
    isPending: dto.status === 'pending',
    requesterName: dto.requesterName,
    reason: dto.reason,
    createdAt: new Date(dto.createdAt),
    reviewerName: dto.reviewerName,
    reviewComment: dto.reviewComment,
    reviewedAt: dto.reviewedAt ? new Date(dto.reviewedAt) : null,
    registration:
      dto.type === 'user.register'
        ? { email: asString(dto.payload.email), displayName: asString(dto.payload.displayName) }
        : null,
  };
}
