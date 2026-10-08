import type {
  ApprovalAssigneeRule,
  ApprovalAssigneeStatus,
  ApprovalCondition,
  ApprovalConditionField,
  ApprovalFlow,
  ApprovalFlowStep,
  ApprovalFlowStepInput,
  PutApprovalFlowRequest,
} from '@/shared/api-sdk';

import {
  APPROVAL_FLOW_MAX_CONDITIONS,
  APPROVAL_FLOW_MAX_STEPS,
  APPROVAL_FLOW_MAX_REQUIRED,
} from '../constants';
import type { AssigneeKind, ConditionOperator } from '../constants';

/**
 * 流程編輯的草稿與它的純函式（docs/architecture/backend/20-approval.md §9.16）：新增／刪除／移動關卡、條件的運算子跟著欄位型別、
 * 草稿 → `PutApprovalFlowRequest`。不碰 React，hook（`useApprovalFlowDraft`）只負責保存狀態。
 */

export type FieldType = ApprovalConditionField['type'];

/** 數字欄位六種比較 ＋ `in`；字串與列舉只有相等、不等與 `in`（與後端 `approval-flow.rules.ts` 一致）。 */
const NUMBER_OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in'] as const;
const EQUALITY_OPERATORS = ['eq', 'ne', 'in'] as const;

export function operatorsFor(type: FieldType): readonly ConditionOperator[] {
  return type === 'number' ? NUMBER_OPERATORS : EQUALITY_OPERATORS;
}

export interface AssigneeDraft {
  kind: AssigneeKind;
  /** 使用者、群組、角色、部門的 id；`manager` 不用。 */
  targetId: string | null;
  /** `manager` 的第幾層主管（1–5）。 */
  level: number;
}

export interface ConditionDraft {
  /** 只給畫面的 React key 用，不送出。 */
  id: string;
  field: string;
  op: ConditionOperator;
  /** 數字、字串欄位的輸入；`in` 時以逗號分隔多個值。 */
  text: string;
  /** 列舉欄位選到的值；`in` 以外只取第一個。 */
  options: string[];
}

export interface StepDraft {
  /** 只給畫面的 React key 用，不送出。 */
  id: string;
  /** 已儲存的關卡的穩定 key；新的關卡沒有，由伺服器產生。 */
  key?: string;
  name: string;
  assignee: AssigneeDraft;
  requiredMode: 'count' | 'all';
  requiredCount: number;
  conditions: ConditionDraft[];
  /** 伺服器上這一關的規則與狀態（顯示名稱、可不可用、是否已刪除）；規則改了就不再適用。 */
  saved?: { assignee: AssigneeDraft; status: ApprovalAssigneeStatus };
}

export interface FlowDraft {
  enabled: boolean;
  allowRepeatApprover: boolean;
  steps: StepDraft[];
  /** 開始編輯時的版本（樂觀鎖）；還沒有流程時為 undefined（第一次儲存不帶 `version`）。 */
  version?: number;
}

let sequence = 0;
const nextId = (prefix: string) => {
  sequence += 1;
  return `${prefix}-${sequence}`;
};

const DEFAULT_ASSIGNEE: AssigneeDraft = { kind: 'user', targetId: null, level: 1 };

export function createStep(): StepDraft {
  return {
    id: nextId('step'),
    name: '',
    assignee: DEFAULT_ASSIGNEE,
    requiredMode: 'count',
    requiredCount: 1,
    conditions: [],
  };
}

function toAssigneeDraft(rule: ApprovalAssigneeRule): AssigneeDraft {
  return rule.kind === 'manager'
    ? { kind: 'manager', targetId: null, level: rule.level }
    : { kind: rule.kind, targetId: rule.id, level: 1 };
}

function toConditionDraft(condition: ApprovalCondition, field?: ApprovalConditionField) {
  const values = Array.isArray(condition.value) ? condition.value : [condition.value];
  const isEnum = field?.type === 'enum';
  return {
    id: nextId('condition'),
    field: condition.field,
    op: condition.op,
    text: isEnum ? '' : values.join(', '),
    options: isEnum ? values.map(String) : [],
  } satisfies ConditionDraft;
}

function toStepDraft(step: ApprovalFlowStep, fields: readonly ApprovalConditionField[]): StepDraft {
  const assignee = toAssigneeDraft(step.assignee);
  return {
    id: nextId('step'),
    key: step.key,
    name: step.name,
    assignee,
    requiredMode: step.requiredApprovals === 'all' ? 'all' : 'count',
    requiredCount: step.requiredApprovals === 'all' ? 1 : step.requiredApprovals,
    conditions: step.conditions.map((condition) =>
      toConditionDraft(
        condition,
        fields.find((field) => field.key === condition.field),
      ),
    ),
    saved: { assignee, status: step.assigneeStatus },
  };
}

/** 伺服器的流程 → 草稿。還沒設定流程時給一個啟用、只有一個空白關卡的草稿（流程至少要一關）。 */
export function flowToDraft(item: ApprovalFlow): FlowDraft {
  if (!item.flow) return { enabled: true, allowRepeatApprover: false, steps: [createStep()] };
  return {
    enabled: item.flow.enabled,
    allowRepeatApprover: item.flow.allowRepeatApprover,
    steps: item.flow.steps.map((step) => toStepDraft(step, item.fields)),
    version: item.flow.version,
  };
}

// ── 關卡 ──────────────────────────────────────────────

export function addStep(draft: FlowDraft): FlowDraft {
  if (draft.steps.length >= APPROVAL_FLOW_MAX_STEPS) return draft;
  return { ...draft, steps: [...draft.steps, createStep()] };
}

/** 流程至少要一關：最後一關不能刪。 */
export function removeStep(draft: FlowDraft, stepId: string): FlowDraft {
  if (draft.steps.length <= 1) return draft;
  return { ...draft, steps: draft.steps.filter((step) => step.id !== stepId) };
}

/** 往上（-1）或往下（+1）移一格；已經在頭尾時不動。 */
export function moveStep(draft: FlowDraft, stepId: string, delta: -1 | 1): FlowDraft {
  const from = draft.steps.findIndex((step) => step.id === stepId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= draft.steps.length) return draft;
  const steps = [...draft.steps];
  const [moved] = steps.splice(from, 1);
  if (!moved) return draft;
  steps.splice(to, 0, moved);
  return { ...draft, steps };
}

export function updateStep(
  draft: FlowDraft,
  stepId: string,
  patch: Partial<Omit<StepDraft, 'id' | 'key' | 'saved'>>,
): FlowDraft {
  return {
    ...draft,
    steps: draft.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
  };
}

/** 換審核者的種類：對象清空（不同種類的 id 不能沿用）。 */
export function changeAssigneeKind(assignee: AssigneeDraft, kind: AssigneeKind): AssigneeDraft {
  return kind === assignee.kind ? assignee : { kind, targetId: null, level: assignee.level };
}

function sameAssignee(left: AssigneeDraft, right: AssigneeDraft): boolean {
  return left.kind === 'manager'
    ? right.kind === 'manager' && left.level === right.level
    : left.kind === right.kind && left.targetId === right.targetId;
}

/** 伺服器上的規則狀態；規則在這次編輯中改過就沒有（新的規則由種類的可用性判斷）。 */
export function savedAssigneeStatus(step: StepDraft): ApprovalAssigneeStatus | undefined {
  return step.saved && sameAssignee(step.saved.assignee, step.assignee)
    ? step.saved.status
    : undefined;
}

// ── 條件 ──────────────────────────────────────────────

/** 新增條件：預設第一個欄位與它的第一個運算子。沒有可用的欄位或到上限時不動。 */
export function addCondition(
  step: StepDraft,
  fields: readonly ApprovalConditionField[],
): StepDraft {
  const [first] = fields;
  if (!first || step.conditions.length >= APPROVAL_FLOW_MAX_CONDITIONS) return step;
  const condition: ConditionDraft = {
    id: nextId('condition'),
    field: first.key,
    op: operatorsFor(first.type)[0] ?? 'eq',
    text: '',
    options: [],
  };
  return { ...step, conditions: [...step.conditions, condition] };
}

/** 換欄位：運算子不適用新欄位的型別時換成第一個可用的；值清空（型別不同）。 */
export function changeConditionField(
  condition: ConditionDraft,
  field: ApprovalConditionField,
): ConditionDraft {
  const operators = operatorsFor(field.type);
  return {
    ...condition,
    field: field.key,
    op: operators.includes(condition.op) ? condition.op : (operators[0] ?? 'eq'),
    text: '',
    options: [],
  };
}

/** 換運算子：從 `in` 換成單一值時，列舉只留第一個。 */
export function changeConditionOperator(
  condition: ConditionDraft,
  op: ConditionOperator,
): ConditionDraft {
  return {
    ...condition,
    op,
    options: op === 'in' ? condition.options : condition.options.slice(0, 1),
  };
}

const splitList = (text: string) =>
  text
    .split(/[,，]/)
    .map((part) => part.trim())
    .filter(Boolean);

/** 條件草稿 → API 的條件；值不完整或數字格式不對時回 null。 */
function toCondition(
  condition: ConditionDraft,
  field: ApprovalConditionField | undefined,
): ApprovalCondition | null {
  if (!field) return null;
  const isList = condition.op === 'in';
  const raw =
    field.type === 'enum'
      ? condition.options
      : isList
        ? splitList(condition.text)
        : [condition.text.trim()].filter(Boolean);
  if (raw.length === 0) return null;
  const values: Array<number | string> = field.type === 'number' ? raw.map(Number) : raw;
  if (values.some((value) => typeof value === 'number' && !Number.isFinite(value))) return null;
  const [single] = values;
  if (single === undefined) return null;
  return { field: field.key, op: condition.op, value: isList ? values : single };
}

function toAssigneeRule(assignee: AssigneeDraft): ApprovalAssigneeRule | null {
  if (assignee.kind === 'manager') return { kind: 'manager', level: assignee.level };
  if (!assignee.targetId) return null;
  return { kind: assignee.kind, id: assignee.targetId };
}

// ── 驗證與送出 ─────────────────────────────────────────

/** 驗證失敗的原因（語系鍵）。 */
export const DRAFT_ISSUE_KEY = {
  required: 'approvalFlow.validation.required',
  invalidValue: 'approvalFlow.validation.invalidValue',
} as const;

/**
 * 送出前在前端能擋的錯誤；key 與後端 `VALIDATION_FAILED` 的 `details.fields` 同一種路徑（`steps.1.conditions.0.value`），
 * 畫面以同一套方式把前後端的錯誤標到欄位上。
 */
export function validateFlowDraft(
  draft: FlowDraft,
  fields: readonly ApprovalConditionField[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  draft.steps.forEach((step, index) => {
    if (!step.name.trim()) errors[`steps.${index}.name`] = DRAFT_ISSUE_KEY.required;
    if (!toAssigneeRule(step.assignee)) {
      errors[`steps.${index}.assignee`] = DRAFT_ISSUE_KEY.required;
    }
    step.conditions.forEach((condition, conditionIndex) => {
      const field = fields.find((candidate) => candidate.key === condition.field);
      const path = `steps.${index}.conditions.${conditionIndex}`;
      if (!field) errors[`${path}.field`] = DRAFT_ISSUE_KEY.required;
      else if (!toCondition(condition, field)) {
        const empty =
          field.type === 'enum' ? condition.options.length === 0 : !condition.text.trim();
        errors[`${path}.value`] = empty ? DRAFT_ISSUE_KEY.required : DRAFT_ISSUE_KEY.invalidValue;
      }
    });
  });
  return errors;
}

/** 關卡草稿 → API 的關卡；有不完整的關卡時回 null（先以 `validateFlowDraft` 找出是哪裡）。 */
export function toStepInputs(
  steps: readonly StepDraft[],
  fields: readonly ApprovalConditionField[],
): ApprovalFlowStepInput[] | null {
  const inputs: ApprovalFlowStepInput[] = [];
  for (const step of steps) {
    const assignee = toAssigneeRule(step.assignee);
    if (!assignee || !step.name.trim()) return null;
    const conditions: ApprovalCondition[] = [];
    for (const draft of step.conditions) {
      const condition = toCondition(
        draft,
        fields.find((field) => field.key === draft.field),
      );
      if (!condition) return null;
      conditions.push(condition);
    }
    inputs.push({
      ...(step.key ? { key: step.key } : {}),
      name: step.name.trim(),
      assignee,
      requiredApprovals:
        step.requiredMode === 'all'
          ? 'all'
          : Math.min(Math.max(1, Math.trunc(step.requiredCount)), APPROVAL_FLOW_MAX_REQUIRED),
      conditions,
    });
  }
  return inputs;
}

/** 草稿 → `PUT /approval-flows/:type` 的 body。第一次儲存（沒有版本）不帶 `version`。 */
export function toPutRequest(
  draft: FlowDraft,
  fields: readonly ApprovalConditionField[],
): PutApprovalFlowRequest | null {
  const steps = toStepInputs(draft.steps, fields);
  if (!steps) return null;
  return {
    enabled: draft.enabled,
    allowRepeatApprover: draft.allowRepeatApprover,
    steps,
    ...(draft.version === undefined ? {} : { version: draft.version }),
  };
}

/** 比對兩份草稿的內容（不含畫面用的 id 與伺服器狀態），判斷有沒有未儲存的修改。 */
export function draftSnapshot(draft: FlowDraft): string {
  return JSON.stringify({
    enabled: draft.enabled,
    allowRepeatApprover: draft.allowRepeatApprover,
    steps: draft.steps.map((step) => ({
      key: step.key,
      name: step.name,
      assignee: step.assignee,
      requiredMode: step.requiredMode,
      requiredCount: step.requiredCount,
      conditions: step.conditions.map(({ field, op, text, options }) => ({
        field,
        op,
        text,
        options,
      })),
    })),
  });
}

/** `errors` 裡有沒有落在 `path`（或它底下）的錯誤。 */
export function hasErrorAt(errors: Readonly<Record<string, string>>, path: string): boolean {
  return Object.keys(errors).some((key) => key === path || key.startsWith(`${path}.`));
}
