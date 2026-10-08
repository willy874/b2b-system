import { PERMISSION } from '@/common/types';

export const APPROVAL_PERMISSIONS = {
  READ: PERMISSION.APPROVAL_READ,
  REVIEW: PERMISSION.APPROVAL_REVIEW,
  OVERRIDE: PERMISSION.APPROVAL_OVERRIDE,
  FLOW_READ: PERMISSION.APPROVAL_FLOW_READ,
  FLOW_UPDATE: PERMISSION.APPROVAL_FLOW_UPDATE,
} as const;

/**
 * 需要審批的變更類型。新增一種類型 = 在這裡加一個值 ＋ 在負責的模組實作並註冊一個
 * `ApprovalHandler`（docs/architecture/backend/20-approval.md §4）。
 */
export const ApprovalType = {
  USER_REGISTER: 'user.register',
  /** 申請資料夾存取（docs/architecture/iam/06-resource-grants.md §6.5）；handler 在 modules/file。 */
  FILE_FOLDER_ACCESS: 'fileFolder.access',
} as const;

export type ApprovalType = (typeof ApprovalType)[keyof typeof ApprovalType];

export const APPROVAL_TYPES = Object.values(ApprovalType) as [ApprovalType, ...ApprovalType[]];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn'] as const;

// ── 多階段（docs/architecture/backend/20-approval.md §9） ──

export const APPROVAL_ASSIGNEE_KINDS = ['user', 'group', 'role', 'manager', 'orgUnit'] as const;
export const APPROVAL_CONDITION_OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'] as const;
export const APPROVAL_STEP_STATUSES = [
  'waiting',
  'active',
  'approved',
  'rejected',
  'skipped',
  'cancelled',
] as const;

/** 一個流程最多幾關、每關最多幾個條件、同意數的上限。 */
export const APPROVAL_FLOW_MAX_STEPS = 10;
export const APPROVAL_FLOW_MAX_CONDITIONS = 5;
export const APPROVAL_FLOW_MAX_REQUIRED = 20;
/** `manager` 規則的「第 N 層主管」上限。 */
export const APPROVAL_MANAGER_MAX_LEVEL = 5;
/** `in` 運算子的值最多幾個。 */
export const APPROVAL_CONDITION_MAX_VALUES = 50;

/** 這兩種規則由組織管理登記：`organization` 未啟用時展開為空。 */
export const ORG_ASSIGNEE_KINDS = ['manager', 'orgUnit'] as const;

/** 待審去重鍵的唯一索引名稱：併發送出同一筆請求時，由它擋下第二筆。 */
export const PENDING_SUBJECT_CONSTRAINT = 'approval_requests_pending_subject_key';
