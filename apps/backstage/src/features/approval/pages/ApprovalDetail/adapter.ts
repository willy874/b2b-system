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
  /** 重新送出時回到這個資料夾的申請對話框。 */
  folderId: string;
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
  /** 這一關開始的時間；還沒輪到、或略過時為 null。 */
  activatedAt: Date | null;
  candidates: Array<{ userId: string; name: string }>;
  decisions: Array<{
    reviewerId: string | null;
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
  /** 匿名的申請（註冊）為 null。 */
  requesterId: string | null;
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
  /**
   * 以單關審核定案、但已經有人做過決定（停用多階段期間的多關請求：目前那一關已做的決定，`withoutChain`）。
   * 其他情況是空陣列。
   */
  singleReviewDecisions: ApprovalStepVM['decisions'];
  /** 目前的登入者能做什麼（後端依可見性、候選人、權限算好）。 */
  viewer: ApprovalViewer;
  /** 這一筆是重新送出的：前一筆的 id。 */
  resubmittedFrom: string | null;
  /** 申請人已重新送出：最新那一筆的 id。 */
  resubmittedTo: string | null;
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
    activatedAt: step.activatedAt ? new Date(step.activatedAt) : null,
    candidates: step.candidates,
    decisions: step.decisions.map((decision) => ({
      reviewerId: decision.reviewerId,
      reviewerName: decision.reviewerName,
      decision: decision.decision,
      via: decision.via,
      comment: decision.comment,
      decidedAt: new Date(decision.decidedAt),
    })),
  };
}

/** 停用期間以單關端點定案（`legacy`）在畫面上就是一般的決定。 */
function plainDecision(
  decision: ApprovalStepVM['decisions'][number],
): ApprovalStepVM['decisions'][number] {
  return decision.via === 'legacy' ? { ...decision, via: 'assignee' } : decision;
}

/** 已經結束、有人做過決定的關卡：停用期間被一次定案而取消的那一關，依它的決定顯示成通過或駁回。 */
function asDecidedStep(step: ApprovalStepVM): ApprovalStepVM {
  const decisions = step.decisions.map(plainDecision);
  if (step.closeReason !== 'chainDisabled') return { ...step, shortage: null, decisions };
  return {
    ...step,
    status: decisions.some((decision) => decision.decision === 'reject') ? 'rejected' : 'approved',
    closeReason: null,
    required: null,
    shortage: null,
    decisions,
  };
}

/**
 * 平台沒有啟用多階段審批時的樣子（docs/architecture/backend/20-approval.md §9.11）：進行中的多關請求改由
 * `approval:review` 一次定案，畫面上就是一筆單關的申請——不顯示目前與之後的關卡、候選人、審核者不足；
 * 已經做出的決定照樣列出（那是誰同意過的紀錄）。沒有啟用的 feature 在畫面上不被提起
 * （docs/architecture/frontend/02-plugin-system.md §7），停用期間定案的標記（`legacy`、`chainDisabled`）也不顯示。
 * 關卡的決定與強制定案這時由後端拒絕，`viewer` 一併收起，不必等詳情重新載入。
 */
export function withoutChain(approval: ApprovalDetailVM): ApprovalDetailVM {
  if (approval.steps.length === 0) return approval;
  const current = approval.isPending ? approval.currentStep : null;
  return {
    ...approval,
    steps: approval.steps
      .filter((step) => step !== current && step.decisions.length > 0)
      .map(asDecidedStep),
    currentStep: null,
    singleReviewDecisions: current ? current.decisions.map(plainDecision) : [],
    viewer: { ...approval.viewer, canDecide: false, canOverride: false },
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
    requesterId: dto.requesterId,
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
        ? {
            folderId: asString(dto.payload.folderId),
            folderName: asString(dto.payload.folderName),
            level: toLevel(dto.payload.level),
          }
        : null,
    steps,
    currentStep: steps.find((step) => step.status === 'active') ?? null,
    singleReviewDecisions: [],
    viewer: dto.viewer,
    resubmittedFrom: dto.resubmittedFrom,
    resubmittedTo: dto.resubmittedTo,
  };
}

/** 結果句（`APPROVAL_OUTCOME_KEY`）的參數：依類型從申請內容取出。等級是語系鍵，由呼叫端翻譯。 */
export function outcomeParams(approval: ApprovalDetailVM): {
  email?: string;
  folder?: string;
  level?: FileAccessLevel;
} {
  if (approval.registration) return { email: approval.registration.email };
  if (approval.folderAccess) {
    return { folder: approval.folderAccess.folderName, level: approval.folderAccess.level };
  }
  return {};
}
