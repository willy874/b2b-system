import { describe, expect, it } from 'vitest';

import type { ApprovalFlow } from '@/shared/api-sdk';

import { toApprovalFlowCardVM } from '../adapter';

const step = (name: string, assigneeStatus = { available: true, deleted: false }) => ({
  name,
  assigneeStatus,
});

const dto = (flow: unknown): ApprovalFlow =>
  ({ type: 'user.register', flow }) as unknown as ApprovalFlow;

describe('toApprovalFlowCardVM（審批流程分頁的一張卡片）', () => {
  it('還沒設定流程 → unset、沒有關卡與版本', () => {
    expect(toApprovalFlowCardVM(dto(null))).toEqual({
      type: 'user.register',
      status: 'unset',
      stepNames: [],
      hasAssigneeIssue: false,
      version: null,
    });
  });

  it('啟用中的流程 → enabled，關卡名稱依序、帶版本', () => {
    const vm = toApprovalFlowCardVM(
      dto({ enabled: true, version: 4, steps: [step('主管'), step('人資')] }),
    );
    expect(vm).toMatchObject({
      status: 'enabled',
      stepNames: ['主管', '人資'],
      hasAssigneeIssue: false,
      version: 4,
    });
  });

  it.each([
    ['規則現在不能用', { available: false, deleted: false }],
    ['規則指到已刪除的對象', { available: true, deleted: true }],
  ])('停用的流程 → disabled；%s → 標出審核者有問題', (_name, assigneeStatus) => {
    const vm = toApprovalFlowCardVM(
      dto({ enabled: false, version: 1, steps: [step('主管'), step('人資', assigneeStatus)] }),
    );
    expect(vm).toMatchObject({ status: 'disabled', hasAssigneeIssue: true });
  });
});
