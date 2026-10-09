import type { ChipTone } from '@b2b-system/ui/Chip';

import type { ApprovalAssigneeRule, ApprovalCondition } from '@/shared/api-sdk';

export type AssigneeKind = ApprovalAssigneeRule['kind'];
export type ConditionOperator = ApprovalCondition['op'];

/** 流程的上限（與後端 `approval.constants.ts` 一致；docs/architecture/backend/20-approval.md §9.3）。 */
export const APPROVAL_FLOW_MAX_STEPS = 10;
export const APPROVAL_FLOW_MAX_CONDITIONS = 5;
export const APPROVAL_FLOW_MAX_REQUIRED = 20;
export const APPROVAL_MANAGER_MAX_LEVEL = 5;

/** 審核者規則依賴的可啟用 feature 的 id（`app/features.ts` 的目錄；feature 之間不互相 import）。 */
export const GROUP_FEATURE_ID = 'group';
export const ORGANIZATION_FEATURE_ID = 'organization';

/**
 * 審批類型的顯示名稱（字面量 key，docs/coding-standards/06-literal-strings.md）。
 * 後端新增了這裡沒有的類型時，畫面以類型字串本身當名稱。
 */
export const APPROVAL_FLOW_TYPE_LABEL_KEY: Readonly<Partial<Record<string, string>>> = {
  'user.register': 'approvalFlow.type.userRegister',
};

/** 條件欄位的顯示名稱（後端的欄位定義沒有語系鍵；不認得的欄位顯示 key 本身）。 */
export const APPROVAL_FLOW_FIELD_LABEL_KEY: Readonly<Partial<Record<string, string>>> = {
  emailDomain: 'approvalFlow.field.emailDomain',
  amount: 'approvalFlow.field.amount',
  category: 'approvalFlow.field.category',
};

export const ASSIGNEE_KIND_LABEL_KEY = {
  user: 'approvalFlow.assignee.kind.user',
  group: 'approvalFlow.assignee.kind.group',
  role: 'approvalFlow.assignee.kind.role',
  manager: 'approvalFlow.assignee.kind.manager',
  orgUnit: 'approvalFlow.assignee.kind.orgUnit',
} as const satisfies Record<AssigneeKind, string>;

export const CONDITION_OPERATOR_LABEL_KEY = {
  eq: 'approvalFlow.condition.op.eq',
  ne: 'approvalFlow.condition.op.ne',
  gt: 'approvalFlow.condition.op.gt',
  gte: 'approvalFlow.condition.op.gte',
  lt: 'approvalFlow.condition.op.lt',
  lte: 'approvalFlow.condition.op.lte',
  in: 'approvalFlow.condition.op.in',
} as const satisfies Record<ConditionOperator, string>;

/** 分頁上的審批方式：單關（`flow` 為 null）／多階段（流程啟用中）／流程已停用（回到單關，設定保留）。 */
export type ApprovalFlowStatus = 'unset' | 'enabled' | 'disabled';

export const APPROVAL_FLOW_STATUS_LABEL_KEY = {
  unset: 'approvalFlow.status.unset',
  enabled: 'approvalFlow.status.enabled',
  disabled: 'approvalFlow.status.disabled',
} as const satisfies Record<ApprovalFlowStatus, string>;

export const APPROVAL_FLOW_STATUS_TONE = {
  unset: 'neutral',
  enabled: 'success',
  disabled: 'warning',
} as const satisfies Record<ApprovalFlowStatus, ChipTone>;

export const PREVIEW_SHORTAGE_LABEL_KEY = {
  noCandidate: 'approvalFlow.preview.shortage.noCandidate',
  insufficient: 'approvalFlow.preview.shortage.insufficient',
} as const satisfies Record<'noCandidate' | 'insufficient', string>;

/**
 * 核准之後會發生什麼（流程摘要的最後一個節點）。審批 feature 有自己的結果句（`features/approval`），feature 之間不 import，
 * 這裡只需要一句不帶參數的說明；不認得的類型用通用的句子。
 */
export const APPROVAL_FLOW_OUTCOME_KEY: Readonly<Partial<Record<string, string>>> = {
  'user.register': 'approvalFlow.outcome.userRegister',
};
export const APPROVAL_FLOW_OUTCOME_DEFAULT_KEY = 'approvalFlow.outcome.default';
