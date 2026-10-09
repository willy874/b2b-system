import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { approvalRequests } from './approval-requests';
import { users } from './users';

/**
 * 審核者規則（docs/architecture/backend/20-approval.md §9）：關卡要找誰。
 * `manager` 是申請人的第 `level` 層主管、`orgUnit` 是某部門的主管（由組織管理解析）。
 */
export type ApprovalAssigneeRule =
  | { kind: 'user'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'role'; id: string }
  | { kind: 'manager'; level: number }
  | { kind: 'orgUnit'; id: string };

export type ApprovalAssigneeKind = ApprovalAssigneeRule['kind'];

export type ApprovalConditionOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';

/** 關卡的一個條件：handler 宣告的欄位、運算子、值（D2）。 */
export interface ApprovalCondition {
  field: string;
  op: ApprovalConditionOperator;
  value: number | string | Array<number | string>;
}

/** 流程裡的一關（`approval_flows.steps` 的元素）。 */
export interface ApprovalFlowStep {
  /** 跨版本追蹤同一關的穩定 key。 */
  key: string;
  name: string;
  assignee: ApprovalAssigneeRule;
  /** 同意數；`'all'` = 關卡啟動時的候選人全部（D5）。 */
  requiredApprovals: number | 'all';
  conditions: ApprovalCondition[];
}

/**
 * 一種審批類型的流程設定（docs/architecture/backend/20-approval.md §9、D1）：每個類型最多一個。
 * 停用（`enabled = false`）保留設定；重設會刪掉這一列（docs/architecture/backend/20-approval.md §12 D10）：進行中的請求帶著關卡的快照與 `flow_version`，不依賴這一列。
 */
export const approvalFlows = pgTable(
  'approval_flows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** 同一個人能不能在同一筆請求審兩關（D6）。 */
    allowRepeatApprover: boolean('allow_repeat_approver').notNull().default(false),
    steps: jsonb('steps').$type<ApprovalFlowStep[]>().notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [uniqueIndex('approval_flows_type_key').on(t.type)],
);

export const approvalStepStatus = pgEnum('approval_step_status', [
  'waiting',
  'active',
  'approved',
  'rejected',
  'skipped',
  'cancelled',
]);

/** 關卡的規則快照：規則本身 ＋ 送出當下的顯示名稱（群組名、部門名…）。 */
export type ApprovalStepAssignee = ApprovalAssigneeRule & { label: string };

/**
 * 請求的關卡：送出時從流程複製（快照）。`required_approvals` 在 `count` 模式送出時填、`all` 模式在啟動時填入候選人數。
 */
export const approvalSteps = pgTable(
  'approval_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => approvalRequests.id, { onDelete: 'cascade' }),
    ordinal: smallint('ordinal').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    assignee: jsonb('assignee').$type<ApprovalStepAssignee>().notNull(),
    requiredMode: text('required_mode').$type<'count' | 'all'>().notNull(),
    requiredApprovals: smallint('required_approvals'),
    conditions: jsonb('conditions').$type<ApprovalCondition[]>().notNull().default([]),
    status: approvalStepStatus('status').notNull(),
    /** 啟動時的短缺：候選人為 0、或少於要求的同意數（D9）。 */
    shortage: text('shortage').$type<'noCandidate' | 'insufficient'>(),
    /** `cancelled`（或 override 結束）的原因。 */
    closeReason: text('close_reason').$type<
      'rejected' | 'withdrawn' | 'chainDisabled' | 'override'
    >(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('approval_steps_request_ordinal_key').on(t.requestId, t.ordinal),
    // 同一筆請求同時只有一個進行中的關卡
    uniqueIndex('approval_steps_one_active_key')
      .on(t.requestId)
      .where(sql`${t.status} = 'active'`),
    check(
      'approval_steps_required_mode',
      sql`${t.requiredMode} IN ('count', 'all') AND (${t.requiredMode} = 'all' OR ${t.requiredApprovals} IS NOT NULL)`,
    ),
  ],
);

/** 關卡啟動時展開的候選人（D4）；`request_id` 冗餘給「待我審核」用。 */
export const approvalStepAssignees = pgTable(
  'approval_step_assignees',
  {
    stepId: uuid('step_id')
      .notNull()
      .references(() => approvalSteps.id, { onDelete: 'cascade' }),
    requestId: uuid('request_id')
      .notNull()
      .references(() => approvalRequests.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addedBy: text('added_by').$type<'activation' | 'refresh'>().notNull(),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.stepId, t.userId] }),
    index('approval_step_assignees_user_idx').on(t.userId, t.requestId),
  ],
);

/** 每一個人在每一關的決定（D16：同一關同一人只有一筆）。 */
export const approvalDecisions = pgTable(
  'approval_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => approvalRequests.id, { onDelete: 'cascade' }),
    stepId: uuid('step_id')
      .notNull()
      .references(() => approvalSteps.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    /** 名稱快照：審核者之後被刪除仍可讀。 */
    reviewerName: text('reviewer_name').notNull(),
    decision: text('decision').$type<'approve' | 'reject'>().notNull(),
    /** `legacy`：停用 approvalChain 期間以單關端點定案（D12）。 */
    via: text('via').$type<'assignee' | 'override' | 'legacy'>().notNull(),
    comment: text('comment'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('approval_decisions_step_reviewer_key').on(t.stepId, t.reviewerId),
    index('approval_decisions_request_idx').on(t.requestId),
    check('approval_decisions_decision', sql`${t.decision} IN ('approve', 'reject')`),
  ],
);

export type ApprovalFlowRow = typeof approvalFlows.$inferSelect;
export type ApprovalFlowInsert = typeof approvalFlows.$inferInsert;
export type ApprovalStepRow = typeof approvalSteps.$inferSelect;
export type ApprovalStepInsert = typeof approvalSteps.$inferInsert;
export type ApprovalStepStatus = (typeof approvalStepStatus.enumValues)[number];
export type ApprovalDecisionRow = typeof approvalDecisions.$inferSelect;
