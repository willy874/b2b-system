import { z } from 'zod';

import { PaginationSchema, QueryArraySchema, SortSchema } from '@/core/http';
import { defineSchema, uniqueItems } from '@/core/validation';

import { APPROVAL_STATUSES, APPROVAL_STEP_STATUSES, APPROVAL_TYPES } from '../approval.constants';
import { ApprovalAssigneeRuleSchema, ApprovalConditionSchema } from './approval-flow.dto';

export const ApprovalStatusSchema = defineSchema('ApprovalStatus', z.enum(APPROVAL_STATUSES));

export const ApprovalTypeSchema = defineSchema('ApprovalType', z.enum(APPROVAL_TYPES));

export const ApprovalRequestSchema = defineSchema(
  'ApprovalRequest',
  z.object({
    id: z.string().uuid(),
    type: ApprovalTypeSchema,
    status: ApprovalStatusSchema,
    /** 依類型而定（`user.register` = `{ email, displayName }`）；不含 `private_payload`。 */
    payload: z.record(z.string(), z.unknown()),
    requesterId: z.string().uuid().nullable(),
    requesterName: z.string(),
    reason: z.string().nullable(),
    reviewerId: z.string().uuid().nullable(),
    reviewerName: z.string().nullable(),
    reviewComment: z.string().nullable(),
    reviewedAt: z.string().nullable(),
    resultResourceId: z.string().nullable(),
    /** 多階段：送出時依的流程版本；單關請求為 null（docs/architecture/backend/20-approval.md §9）。 */
    flowVersion: z.number().int().nullable(),
    /** 多階段：目前的關卡；單關請求、或已結束時為 null。 */
    currentStep: z
      .object({
        ordinal: z.number().int(),
        name: z.string(),
        /** 目前的同意數。 */
        approvals: z.number().int(),
        /** 需要的同意數（`all` 已換成啟動時的人數）。 */
        required: z.number().int(),
        shortage: z.enum(['noCandidate', 'insufficient']).nullable(),
      })
      .nullable(),
    /** 多階段：關卡的總數（含略過的）；單關請求為 0。 */
    stepCount: z.number().int(),
    /** 駁回或撤回後重新送出時，前一筆的 id。 */
    resubmittedFrom: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const ApprovalStepStatusSchema = defineSchema(
  'ApprovalStepStatus',
  z.enum(APPROVAL_STEP_STATUSES),
);

export const ApprovalDecisionSchema = defineSchema(
  'ApprovalDecision',
  z.object({
    reviewerId: z.string().uuid().nullable(),
    reviewerName: z.string(),
    decision: z.enum(['approve', 'reject']),
    /** `override`：強制定案；`legacy`：多階段停用期間以單關端點定案。 */
    via: z.enum(['assignee', 'override', 'legacy']),
    comment: z.string().nullable(),
    decidedAt: z.string(),
  }),
);

export const ApprovalStepSchema = defineSchema(
  'ApprovalStep',
  z.object({
    ordinal: z.number().int(),
    key: z.string(),
    name: z.string(),
    /** 規則 ＋ 送出當下的顯示名稱。 */
    assignee: z.intersection(ApprovalAssigneeRuleSchema, z.object({ label: z.string() })),
    requiredMode: z.enum(['count', 'all']),
    /** 需要的同意數；`all` 模式在關卡啟動前為 null。 */
    required: z.number().int().nullable(),
    status: ApprovalStepStatusSchema,
    shortage: z.enum(['noCandidate', 'insufficient']).nullable(),
    closeReason: z.enum(['rejected', 'withdrawn', 'chainDisabled', 'override']).nullable(),
    conditions: z.array(ApprovalConditionSchema),
    activatedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    /** 關卡啟動時展開的候選人（含之後 refresh 加入的）。 */
    candidates: z.array(z.object({ userId: z.string().uuid(), name: z.string() })),
    decisions: z.array(ApprovalDecisionSchema),
  }),
);

/** 目前的登入者能對這筆請求做什麼（前端據此顯示操作）。 */
export const ApprovalViewerSchema = defineSchema(
  'ApprovalViewer',
  z.object({
    /** 是目前關卡的候選人、還沒決定、不是申請人。 */
    canDecide: z.boolean(),
    /** 有 `approval:override`，而且這是一筆進行中的多關請求。 */
    canOverride: z.boolean(),
    /** 單關的核准／駁回（`approval:review`；多階段停用期間也用於多關請求）。 */
    canReviewSingle: z.boolean(),
    /** 申請人本人、仍待審。 */
    canWithdraw: z.boolean(),
  }),
);

export const ApprovalRequestDetailSchema = defineSchema(
  'ApprovalRequestDetail',
  ApprovalRequestSchema.extend({
    steps: z.array(ApprovalStepSchema),
    viewer: ApprovalViewerSchema,
  }),
);

export const ListApprovalSchema = PaginationSchema.extend({
  /**
   * `all`：全部（需要 `approval:read`）；`assigned`：待我審核（我是目前關卡的候選人、還沒決定）；`mine`：我送出的
   * （docs/architecture/backend/20-approval.md §9.10）。
   */
  scope: z.enum(['all', 'assigned', 'mine']).default('all'),
  /** 申請人名稱（註冊 = email）的部分比對。 */
  keyword: z.string().trim().max(100).optional(),
  status: QueryArraySchema(z.enum(APPROVAL_STATUSES)),
  type: QueryArraySchema(z.enum(APPROVAL_TYPES)),
}).extend(SortSchema(['createdAt', 'reviewedAt']).shape);

const CommentSchema = z.string().trim().max(500);

export const ApproveApprovalSchema = defineSchema(
  'ApproveApprovalRequest',
  z.object({
    comment: CommentSchema.optional(),
    /** `user.register`：核准時一併指派的角色（受反提權限制）；其他類型忽略。 */
    roleIds: uniqueItems(z.array(z.string().uuid()).max(20)).default([]),
  }),
);

export const RejectApprovalSchema = defineSchema(
  'RejectApprovalRequest',
  z.object({ comment: CommentSchema.optional() }),
);

const DecisionSchema = z.enum(['approve', 'reject']);

export const DecideApprovalStepSchema = defineSchema(
  'DecideApprovalStepRequest',
  z.object({
    decision: DecisionSchema,
    comment: CommentSchema.optional(),
    /** 只在最後一關、`user.register` 有意義（同 `POST /approvals/:id/approve`）。 */
    roleIds: uniqueItems(z.array(z.string().uuid()).max(20)).default([]),
  }),
);

export const OverrideApprovalStepSchema = defineSchema(
  'OverrideApprovalStepRequest',
  z.object({
    decision: DecisionSchema,
    /** 強制定案一定要留下理由。 */
    comment: CommentSchema.min(1),
    roleIds: uniqueItems(z.array(z.string().uuid()).max(20)).default([]),
  }),
);

export type ApprovalRequestDto = z.infer<typeof ApprovalRequestSchema>;
export type ApprovalRequestDetailDto = z.infer<typeof ApprovalRequestDetailSchema>;
export type ApprovalStepDto = z.infer<typeof ApprovalStepSchema>;
export type ApprovalViewerDto = z.infer<typeof ApprovalViewerSchema>;
export type DecideApprovalStepDto = z.infer<typeof DecideApprovalStepSchema>;
export type OverrideApprovalStepDto = z.infer<typeof OverrideApprovalStepSchema>;
export type ListApprovalDto = z.infer<typeof ListApprovalSchema>;
export type ApproveApprovalDto = z.infer<typeof ApproveApprovalSchema>;
export type RejectApprovalDto = z.infer<typeof RejectApprovalSchema>;
