import type { ApprovalRequestDetail, ApprovalStep, ApprovalViewer } from '@/shared/api-sdk';

import { FILE_ACCESS_LEVELS } from '../../constants';
import type { FileAccessLevel } from '../../constants';

/** `user.register` 的申請內容。 */
export interface RegistrationVM {
  email: string;
  displayName: string;
}

/** `fileFolder.access` 的申請內容。 */
export interface FolderAccessVM {
  folderName: string;
  level: FileAccessLevel;
}

/** 多階段的一關（docs/architecture/backend/20-approval.md §9）。 */
export interface ApprovalStepVM {
  ordinal: number;
  name: string;
  status: ApprovalStep['status'];
  assignee: ApprovalStep['assignee'];
  /** 需要的同意數；`all` 模式啟動前為 null。 */
  required: number | null;
  /** 目前的同意數。 */
  approvals: number;
  shortage: ApprovalStep['shortage'];
  closeReason: ApprovalStep['closeReason'];
  candidates: Array<{ userId: string; name: string }>;
  decisions: Array<{
    reviewerName: string;
    decision: 'approve' | 'reject';
    via: 'assignee' | 'override' | 'legacy';
    comment: string | null;
    decidedAt: Date;
  }>;
}

export interface ApprovalDetailVM {
  id: string;
  type: ApprovalRequestDetail['type'];
  status: ApprovalRequestDetail['status'];
  isPending: boolean;
  requesterName: string;
  reason: string | null;
  createdAt: Date;
  reviewerName: string | null;
  reviewComment: string | null;
  reviewedAt: Date | null;
  /** `type = user.register` 時才有 */
  registration: RegistrationVM | null;
  /** `type = fileFolder.access` 時才有 */
  folderAccess: FolderAccessVM | null;
  /** 多階段的關卡；單關請求是空陣列。 */
  steps: ApprovalStepVM[];
  /** 目前的關卡；單關、已結束、或關卡全部略過時為 null。 */
  currentStep: ApprovalStepVM | null;
  /** 目前的登入者能做什麼（後端依可見性、候選人、權限算好）。 */
  viewer: ApprovalViewer;
}

function toStepVM(step: ApprovalStep): ApprovalStepVM {
  return {
    ordinal: step.ordinal,
    name: step.name,
    status: step.status,
    assignee: step.assignee,
    required: step.required,
    approvals: step.decisions.filter((decision) => decision.decision === 'approve').length,
    shortage: step.shortage,
    closeReason: step.closeReason,
    candidates: step.candidates,
    decisions: step.decisions.map((decision) => ({
      reviewerName: decision.reviewerName,
      decision: decision.decision,
      via: decision.via,
      comment: decision.comment,
      decidedAt: new Date(decision.decidedAt),
    })),
  };
}

function toLevel(value: unknown): FileAccessLevel {
  return FILE_ACCESS_LEVELS.find((level) => level === value) ?? 'viewer';
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

/** `payload` 依類型而定，後端型別是 `Record<string, unknown>`：在這裡收斂成畫面要的形狀。 */
export function toApprovalDetailVM(dto: ApprovalRequestDetail): ApprovalDetailVM {
  const steps = dto.steps.map(toStepVM);
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
    folderAccess:
      dto.type === 'fileFolder.access'
        ? { folderName: asString(dto.payload.folderName), level: toLevel(dto.payload.level) }
        : null,
    steps,
    currentStep: steps.find((step) => step.status === 'active') ?? null,
    viewer: dto.viewer,
  };
}
