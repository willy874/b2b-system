import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import {
  APPROVAL_CONDITION_MAX_VALUES,
  APPROVAL_CONDITION_OPERATORS,
  APPROVAL_FLOW_MAX_CONDITIONS,
  APPROVAL_FLOW_MAX_REQUIRED,
  APPROVAL_FLOW_MAX_STEPS,
  APPROVAL_MANAGER_MAX_LEVEL,
} from '../approval.constants';

/** 審核者規則（docs/architecture/backend/20-approval.md §9.2）。 */
export const ApprovalAssigneeRuleSchema = defineSchema(
  'ApprovalAssigneeRule',
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('user'), id: z.string().uuid() }),
    z.object({ kind: z.literal('group'), id: z.string().uuid() }),
    z.object({ kind: z.literal('role'), id: z.string().uuid() }),
    z.object({
      kind: z.literal('manager'),
      level: z.number().int().min(1).max(APPROVAL_MANAGER_MAX_LEVEL),
    }),
    z.object({ kind: z.literal('orgUnit'), id: z.string().uuid() }),
  ]),
);

const ConditionValueSchema = z.union([z.number(), z.string().trim().max(200)]);

export const ApprovalConditionSchema = defineSchema(
  'ApprovalCondition',
  z.object({
    field: z.string().trim().min(1).max(64),
    op: z.enum(APPROVAL_CONDITION_OPERATORS),
    value: z.union([
      ConditionValueSchema,
      z.array(ConditionValueSchema).min(1).max(APPROVAL_CONDITION_MAX_VALUES),
    ]),
  }),
);

export const ApprovalFlowStepInputSchema = defineSchema(
  'ApprovalFlowStepInput',
  z.object({
    /** 跨版本追蹤同一關的穩定 key；新的關卡省略，由伺服器產生。 */
    key: z.string().trim().min(1).max(64).optional(),
    name: z.string().trim().normalize('NFC').min(1).max(64),
    assignee: ApprovalAssigneeRuleSchema,
    /** 同意數，或 `all`（關卡啟動時的候選人全部）。 */
    requiredApprovals: z.union([
      z.number().int().min(1).max(APPROVAL_FLOW_MAX_REQUIRED),
      z.literal('all'),
    ]),
    conditions: z.array(ApprovalConditionSchema).max(APPROVAL_FLOW_MAX_CONDITIONS).default([]),
  }),
);

export const PutApprovalFlowSchema = defineSchema(
  'PutApprovalFlowRequest',
  z.object({
    enabled: z.boolean(),
    allowRepeatApprover: z.boolean().default(false),
    steps: z.array(ApprovalFlowStepInputSchema).min(1).max(APPROVAL_FLOW_MAX_STEPS),
    /** 樂觀鎖：修改既有流程時必帶；建立第一版時省略。不同回 409 `APPROVAL_FLOW_VERSION_CONFLICT`。 */
    version: z.number().int().min(1).optional(),
  }),
);

/** 規則指到的對象目前的狀態：顯示名稱、是否已刪除、這種規則現在能不能用（feature 是否啟用）。 */
export const ApprovalAssigneeStatusSchema = defineSchema(
  'ApprovalAssigneeStatus',
  z.object({
    label: z.string(),
    available: z.boolean(),
    deleted: z.boolean(),
  }),
);

export const ApprovalFlowStepSchema = defineSchema(
  'ApprovalFlowStep',
  z.object({
    key: z.string(),
    name: z.string(),
    assignee: ApprovalAssigneeRuleSchema,
    assigneeStatus: ApprovalAssigneeStatusSchema,
    requiredApprovals: z.union([z.number().int(), z.literal('all')]),
    conditions: z.array(ApprovalConditionSchema),
  }),
);

export const ApprovalConditionFieldSchema = defineSchema(
  'ApprovalConditionField',
  z.object({
    key: z.string(),
    type: z.enum(['number', 'string', 'enum']),
    options: z.array(z.string()).nullable(),
  }),
);

/** 一種支援流程的審批類型與它的流程（還沒設定時 `flow` 為 null）。 */
export const ApprovalFlowSchema = defineSchema(
  'ApprovalFlow',
  z.object({
    type: z.string(),
    requester: z.enum(['user', 'anonymous']),
    fields: z.array(ApprovalConditionFieldSchema),
    flow: z
      .object({
        id: z.string().uuid(),
        enabled: z.boolean(),
        allowRepeatApprover: z.boolean(),
        steps: z.array(ApprovalFlowStepSchema),
        version: z.number().int(),
        updatedAt: z.string(),
      })
      .nullable(),
  }),
);

export const ApprovalFlowListSchema = defineSchema(
  'ApprovalFlowList',
  z.object({
    items: z.array(ApprovalFlowSchema),
    /** 各種規則目前能不能用（`manager`／`orgUnit` 看組織管理、`group` 看群組）。 */
    assigneeKinds: z.object({
      user: z.boolean(),
      group: z.boolean(),
      role: z.boolean(),
      manager: z.boolean(),
      orgUnit: z.boolean(),
    }),
  }),
);

export const PreviewApprovalFlowSchema = defineSchema(
  'PreviewApprovalFlowRequest',
  z.object({
    /** 未儲存的草稿；省略時用已儲存的流程。 */
    steps: z.array(ApprovalFlowStepInputSchema).min(1).max(APPROVAL_FLOW_MAX_STEPS).optional(),
    allowRepeatApprover: z.boolean().optional(),
    /** 假設的申請人；匿名類型或省略時沒有申請人（`manager` 找不到人）。 */
    requesterId: z.string().uuid().nullable().optional(),
    /** 條件欄位的值（`{ amount: 80000 }`）。 */
    fields: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).default({}),
  }),
);

export const ApprovalCandidateSchema = defineSchema(
  'ApprovalCandidate',
  z.object({ userId: z.string().uuid(), name: z.string() }),
);

export const ApprovalFlowPreviewSchema = defineSchema(
  'ApprovalFlowPreview',
  z.object({
    steps: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        skipped: z.boolean(),
        candidates: z.array(ApprovalCandidateSchema),
        /** 需要的同意數（`all` 已換成人數）；略過的關卡為 null。 */
        required: z.number().int().nullable(),
        shortage: z.enum(['noCandidate', 'insufficient']).nullable(),
      }),
    ),
  }),
);

export type PutApprovalFlowDto = z.infer<typeof PutApprovalFlowSchema>;
export type ApprovalFlowStepInputDto = z.infer<typeof ApprovalFlowStepInputSchema>;
export type ApprovalFlowDto = z.infer<typeof ApprovalFlowSchema>;
export type ApprovalFlowListDto = z.infer<typeof ApprovalFlowListSchema>;
export type PreviewApprovalFlowDto = z.infer<typeof PreviewApprovalFlowSchema>;
export type ApprovalFlowPreviewDto = z.infer<typeof ApprovalFlowPreviewSchema>;
