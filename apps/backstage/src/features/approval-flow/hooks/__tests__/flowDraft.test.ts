import { describe, expect, it } from 'vitest';

import type { ApprovalConditionField, ApprovalFlow } from '@/shared/api-sdk';

import {
  addCondition,
  addStep,
  changeAssigneeKind,
  changeConditionField,
  changeConditionOperator,
  createStep,
  flowToDraft,
  moveStep,
  operatorsFor,
  removeStep,
  savedAssigneeStatus,
  toPutRequest,
  updateStep,
  validateFlowDraft,
} from '../flowDraft';
import type { FlowDraft, StepDraft } from '../flowDraft';

const FIELDS: ApprovalConditionField[] = [
  { key: 'amount', type: 'number', options: null },
  { key: 'category', type: 'enum', options: ['it', 'office'] },
  { key: 'emailDomain', type: 'string', options: null },
];
const fieldOf = (key: string) => {
  const found = FIELDS.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`沒有欄位 ${key}`);
  return found;
};

const SAVED: ApprovalFlow = {
  type: 'test.purchase',
  requester: 'user',
  fields: FIELDS,
  flow: {
    id: 'f1',
    enabled: true,
    allowRepeatApprover: false,
    version: 3,
    updatedAt: '2026-10-01T00:00:00.000Z',
    steps: [
      {
        key: 'k-manager',
        name: '主管',
        assignee: { kind: 'manager', level: 1 },
        assigneeStatus: { label: '第 1 層主管', available: true, deleted: false },
        requiredApprovals: 1,
        conditions: [],
      },
      {
        key: 'k-finance',
        name: '財務',
        assignee: { kind: 'group', id: 'g-finance' },
        assigneeStatus: { label: '財務部', available: true, deleted: false },
        requiredApprovals: 'all',
        conditions: [
          { field: 'amount', op: 'gte', value: 50000 },
          { field: 'category', op: 'in', value: ['it', 'office'] },
        ],
      },
    ],
  },
};

const stepNames = (draft: FlowDraft) => draft.steps.map((step) => step.name);
const named = (name: string): StepDraft => ({
  ...createStep(),
  name,
  assignee: { kind: 'user', targetId: 'u1', level: 1 },
});

describe('flowToDraft（伺服器的流程 → 草稿）', () => {
  it('還沒設定流程：啟用、一個空白關卡、沒有版本', () => {
    const draft = flowToDraft({ ...SAVED, flow: null });
    expect(draft).toMatchObject({ enabled: true, allowRepeatApprover: false });
    expect(draft.version).toBeUndefined();
    expect(draft.steps).toHaveLength(1);
  });

  it('已儲存的流程：保留 key、版本、同意數的方式與條件', () => {
    const draft = flowToDraft(SAVED);
    expect(draft.version).toBe(3);
    expect(draft.steps.map((step) => step.key)).toEqual(['k-manager', 'k-finance']);
    expect(draft.steps[1]).toMatchObject({ requiredMode: 'all' });
    expect(
      draft.steps[1]?.conditions.map(({ field, op, text, options }) => ({
        field,
        op,
        text,
        options,
      })),
    ).toEqual([
      { field: 'amount', op: 'gte', text: '50000', options: [] },
      { field: 'category', op: 'in', text: '', options: ['it', 'office'] },
    ]);
  });
});

describe('關卡的新增、刪除、移動', () => {
  const base: FlowDraft = {
    enabled: true,
    allowRepeatApprover: false,
    steps: [named('A'), named('B'), named('C')],
  };

  it('新增加在最後；到 10 關之後不再增加', () => {
    expect(stepNames(addStep(base))).toEqual(['A', 'B', 'C', '']);
    let full = base;
    for (let count = 0; count < 20; count += 1) full = addStep(full);
    expect(full.steps).toHaveLength(10);
  });

  it('刪除指定的關卡；只剩一關時不能刪', () => {
    const [, second] = base.steps;
    expect(stepNames(removeStep(base, second?.id ?? ''))).toEqual(['A', 'C']);
    const single: FlowDraft = { ...base, steps: [named('A')] };
    expect(removeStep(single, single.steps[0]?.id ?? '')).toBe(single);
  });

  it('上下移動；在頭尾時不動', () => {
    const [first, , last] = base.steps;
    expect(stepNames(moveStep(base, last?.id ?? '', -1))).toEqual(['A', 'C', 'B']);
    expect(stepNames(moveStep(base, first?.id ?? '', 1))).toEqual(['B', 'A', 'C']);
    expect(moveStep(base, first?.id ?? '', -1)).toBe(base);
    expect(moveStep(base, last?.id ?? '', 1)).toBe(base);
  });

  it('換審核者的種類：對象清空', () => {
    expect(changeAssigneeKind({ kind: 'group', targetId: 'g1', level: 2 }, 'role')).toEqual({
      kind: 'role',
      targetId: null,
      level: 2,
    });
  });

  it('規則改過之後不再沿用伺服器的狀態（已刪除、不可用的警示只屬於原本的規則）', () => {
    const draft = flowToDraft(SAVED);
    const finance = draft.steps[1];
    if (!finance) throw new Error('缺少第二關');
    expect(savedAssigneeStatus(finance)).toMatchObject({ label: '財務部' });
    const changed = updateStep(draft, finance.id, {
      assignee: { kind: 'group', targetId: 'g-other', level: 1 },
    });
    expect(savedAssigneeStatus(changed.steps[1] as StepDraft)).toBeUndefined();
  });
});

describe('條件的運算子跟著欄位型別（docs/architecture/backend/20-approval.md §10.2 D2）', () => {
  it('數字欄位六種比較 ＋ in；字串與列舉只有 eq／ne／in', () => {
    expect(operatorsFor('number')).toEqual(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in']);
    expect(operatorsFor('string')).toEqual(['eq', 'ne', 'in']);
    expect(operatorsFor('enum')).toEqual(['eq', 'ne', 'in']);
  });

  it('新增條件預設第一個欄位與它的第一個運算子', () => {
    const step = addCondition(named('A'), FIELDS);
    expect(step.conditions[0]).toMatchObject({ field: 'amount', op: 'eq', text: '' });
  });

  it('數字欄位換到列舉：gte 不適用 → 換成 eq，值清空', () => {
    const condition = { id: 'c1', field: 'amount', op: 'gte' as const, text: '100', options: [] };
    expect(changeConditionField(condition, fieldOf('category'))).toMatchObject({
      field: 'category',
      op: 'eq',
      text: '',
      options: [],
    });
  });

  it('運算子仍適用新欄位時保留（in → in）', () => {
    const condition = { id: 'c1', field: 'amount', op: 'in' as const, text: '1, 2', options: [] };
    expect(changeConditionField(condition, fieldOf('emailDomain')).op).toBe('in');
  });

  it('列舉從 in 換成 eq：只留第一個值', () => {
    const condition = {
      id: 'c1',
      field: 'category',
      op: 'in' as const,
      text: '',
      options: ['it', 'office'],
    };
    expect(changeConditionOperator(condition, 'eq').options).toEqual(['it']);
  });
});

describe('toPutRequest（草稿 → PUT /approval-flows/:type）', () => {
  it('已儲存的流程原封不動轉回去：帶 key 與 version', () => {
    expect(toPutRequest(flowToDraft(SAVED), FIELDS)).toEqual({
      enabled: true,
      allowRepeatApprover: false,
      version: 3,
      steps: [
        {
          key: 'k-manager',
          name: '主管',
          assignee: { kind: 'manager', level: 1 },
          requiredApprovals: 1,
          conditions: [],
        },
        {
          key: 'k-finance',
          name: '財務',
          assignee: { kind: 'group', id: 'g-finance' },
          requiredApprovals: 'all',
          conditions: [
            { field: 'amount', op: 'gte', value: 50000 },
            { field: 'category', op: 'in', value: ['it', 'office'] },
          ],
        },
      ],
    });
  });

  it('第一次儲存不帶 version；新關卡不帶 key；數字的 in 轉成數字陣列、字串去空白', () => {
    const step: StepDraft = {
      ...named(' 採購 '),
      requiredCount: 2,
      conditions: [
        { id: 'c1', field: 'amount', op: 'in', text: '100, 200，300', options: [] },
        { id: 'c2', field: 'emailDomain', op: 'ne', text: ' example.com ', options: [] },
      ],
    };
    const request = toPutRequest(
      { enabled: false, allowRepeatApprover: true, steps: [step] },
      FIELDS,
    );
    expect(request).not.toHaveProperty('version');
    expect(request?.steps[0]).not.toHaveProperty('key');
    expect(request?.steps[0]).toMatchObject({
      name: '採購',
      assignee: { kind: 'user', id: 'u1' },
      requiredApprovals: 2,
      conditions: [
        { field: 'amount', op: 'in', value: [100, 200, 300] },
        { field: 'emailDomain', op: 'ne', value: 'example.com' },
      ],
    });
  });

  it('有不完整的關卡時回 null，validateFlowDraft 指出是哪個欄位（與後端同一種路徑）', () => {
    const draft: FlowDraft = {
      enabled: true,
      allowRepeatApprover: false,
      steps: [
        named('A'),
        {
          ...createStep(),
          conditions: [{ id: 'c1', field: 'amount', op: 'gt', text: 'abc', options: [] }],
        },
      ],
    };
    expect(toPutRequest(draft, FIELDS)).toBeNull();
    expect(validateFlowDraft(draft, FIELDS)).toEqual({
      'steps.1.name': 'approvalFlow.validation.required',
      'steps.1.assignee': 'approvalFlow.validation.required',
      'steps.1.conditions.0.value': 'approvalFlow.validation.invalidValue',
    });
  });
});
