import { describe, expect, it } from 'vitest';

import type { ApprovalCondition, ApprovalFlowStep } from '@/db/schema';

import { conditionsMet, conditionsMetByValues, validateFlowSteps } from '../approval-flow.rules';
import type { ApprovalFlowSupport } from '../approval.types';

const SUPPORT: ApprovalFlowSupport = {
  requester: 'user',
  fields: [
    {
      key: 'amount',
      type: 'number',
      read: (payload) => (typeof payload.amount === 'number' ? payload.amount : null),
    },
    {
      key: 'category',
      type: 'enum',
      options: ['hardware', 'software'],
      read: (payload) => (typeof payload.category === 'string' ? payload.category : null),
    },
    {
      key: 'note',
      type: 'string',
      read: (payload) => (typeof payload.note === 'string' ? payload.note : null),
    },
  ],
};

function step(overrides: Partial<ApprovalFlowStep> = {}): ApprovalFlowStep {
  return {
    key: 'k1',
    name: '關卡',
    assignee: { kind: 'user', id: '00000000-0000-4000-8000-000000000001' },
    requiredApprovals: 1,
    conditions: [],
    ...overrides,
  };
}

describe('conditionsMet（docs/architecture/backend/20-approval.md §9.5、D2）', () => {
  const payload = { amount: 80000, category: 'hardware' };
  it.each<[string, ApprovalCondition[], boolean]>([
    ['沒有條件 → 成立', [], true],
    ['gte 成立', [{ field: 'amount', op: 'gte', value: 50000 }], true],
    ['gte 不成立', [{ field: 'amount', op: 'gte', value: 100000 }], false],
    [
      'gt／lt／lte',
      [
        { field: 'amount', op: 'gt', value: 79999 },
        { field: 'amount', op: 'lt', value: 80001 },
        { field: 'amount', op: 'lte', value: 80000 },
      ],
      true,
    ],
    [
      'eq／ne',
      [
        { field: 'category', op: 'eq', value: 'hardware' },
        { field: 'category', op: 'ne', value: 'software' },
      ],
      true,
    ],
    ['in', [{ field: 'category', op: 'in', value: ['software', 'hardware'] }], true],
    [
      'AND：一個不成立就不成立',
      [
        { field: 'amount', op: 'gte', value: 1 },
        { field: 'category', op: 'eq', value: 'software' },
      ],
      false,
    ],
    ['欄位不在宣告裡 → 不成立', [{ field: 'unknown', op: 'eq', value: 1 }], false],
    ['型別不同 → 不成立', [{ field: 'amount', op: 'eq', value: '80000' }], false],
  ])('%s', (_name, conditions, expected) => {
    expect(conditionsMet(conditions, SUPPORT, payload)).toBe(expected);
  });

  it('payload 取不到值 → 不成立（關卡略過）', () => {
    expect(conditionsMet([{ field: 'amount', op: 'ne', value: 1 }], SUPPORT, {})).toBe(false);
  });

  it('試算以欄位值比對；沒給的欄位不成立', () => {
    expect(conditionsMetByValues([{ field: 'amount', op: 'gte', value: 1 }], { amount: 2 })).toBe(
      true,
    );
    expect(conditionsMetByValues([{ field: 'amount', op: 'gte', value: 1 }], {})).toBe(false);
  });
});

describe('validateFlowSteps', () => {
  it('合法的流程沒有錯誤', () => {
    expect(
      validateFlowSteps(
        [
          step({ conditions: [{ field: 'amount', op: 'gte', value: 1 }] }),
          step({ key: 'k2', conditions: [{ field: 'category', op: 'in', value: ['hardware'] }] }),
        ],
        SUPPORT,
      ),
    ).toEqual({});
  });

  it.each<[string, ApprovalFlowStep[], string]>([
    ['關卡的 key 重複', [step(), step()], 'steps.1.key'],
    [
      '欄位不在宣告裡',
      [step({ conditions: [{ field: 'x', op: 'eq', value: 1 }] })],
      'steps.0.conditions.0.field',
    ],
    [
      '字串欄位用大小比較',
      [step({ conditions: [{ field: 'note', op: 'gt', value: 'a' }] })],
      'steps.0.conditions.0.op',
    ],
    [
      '數字欄位給字串',
      [step({ conditions: [{ field: 'amount', op: 'eq', value: '1' }] })],
      'steps.0.conditions.0.value',
    ],
    [
      'in 沒給清單',
      [step({ conditions: [{ field: 'amount', op: 'in', value: 1 }] })],
      'steps.0.conditions.0.value',
    ],
    [
      '非 in 給了清單',
      [step({ conditions: [{ field: 'amount', op: 'eq', value: [1] }] })],
      'steps.0.conditions.0.value',
    ],
    [
      '列舉的值不在選項裡',
      [step({ conditions: [{ field: 'category', op: 'eq', value: 'food' }] })],
      'steps.0.conditions.0.value',
    ],
  ])('%s', (_name, steps, path) => {
    expect(Object.keys(validateFlowSteps(steps, SUPPORT))).toEqual([path]);
  });

  it('匿名申請的類型不能用 manager 規則', () => {
    expect(
      validateFlowSteps([step({ assignee: { kind: 'manager', level: 1 } })], {
        ...SUPPORT,
        requester: 'anonymous',
      }),
    ).toEqual({ 'steps.0.assignee.kind': 'manager is not available for anonymous requests' });
  });
});
