import type { ApprovalRequest } from '@/shared/api-sdk';

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

export function toMyApprovalRowVM(dto: ApprovalRequest): MyApprovalRowVM {
  return {
    id: dto.id,
    type: dto.type,
    status: dto.status,
    requesterName: dto.requesterName,
    createdAt: new Date(dto.createdAt),
    progress: dto.currentStep,
    stepCount: dto.stepCount,
  };
}
