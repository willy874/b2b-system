import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ApprovalFlow } from '@/shared/api-sdk';

import { addStep } from '../flowDraft';
import { useApprovalFlowDraft } from '../useApprovalFlowDraft';

const flow = (version: number, name: string): ApprovalFlow => ({
  type: 'user.register',
  requester: 'anonymous',
  requiredPermissions: [],
  inFlightCount: 0,
  fields: [],
  flow: {
    id: 'f1',
    enabled: true,
    allowRepeatApprover: false,
    version,
    updatedAt: '2026-10-01T00:00:00.000Z',
    steps: [
      {
        key: 'k1',
        name,
        assignee: { kind: 'role', id: 'r1' },
        assigneeStatus: { label: 'admin', available: true, deleted: false },
        requiredApprovals: 1,
        conditions: [],
      },
    ],
  },
});

describe('useApprovalFlowDraft（流程編輯的草稿）', () => {
  it('沒有改動時跟著伺服器的流程走，不算 dirty', () => {
    const { result, rerender } = renderHook(({ item }) => useApprovalFlowDraft(item), {
      initialProps: { item: flow(1, '管理者') },
    });
    expect(result.current.isDirty).toBe(false);
    rerender({ item: flow(2, '新名稱') });
    expect(result.current.draft?.steps[0]?.name).toBe('新名稱');
    expect(result.current.draft?.version).toBe(2);
  });

  it('改動之後保留草稿與開始編輯時的版本；discard 回到伺服器的流程', () => {
    const { result, rerender } = renderHook(({ item }) => useApprovalFlowDraft(item), {
      initialProps: { item: flow(1, '管理者') },
    });
    act(() => result.current.update(addStep));
    expect(result.current.isDirty).toBe(true);
    // 別人在這段時間存過：草稿不被覆蓋，版本停在 1（儲存時由後端回 409）
    rerender({ item: flow(2, '別人改的') });
    expect(result.current.draft?.steps).toHaveLength(2);
    expect(result.current.draft?.version).toBe(1);
    act(() => result.current.discard());
    expect(result.current.draft?.steps.map((step) => step.name)).toEqual(['別人改的']);
    expect(result.current.isDirty).toBe(false);
  });
});
