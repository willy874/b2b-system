import { describe, expect, it } from 'vitest';

import type { ApprovalRequest } from '@/shared/api-sdk';

import { toApprovalDetailVM } from '../adapter';

const BASE: ApprovalRequest = {
  id: 'a1',
  type: 'user.register',
  status: 'pending',
  payload: { email: 'alice@example.com', displayName: 'Alice' },
  requesterId: null,
  requesterName: 'alice@example.com',
  reason: '新進企劃',
  reviewerId: null,
  reviewerName: null,
  reviewComment: null,
  reviewedAt: null,
  resultResourceId: null,
  createdAt: '2026-09-25T01:00:00.000Z',
  updatedAt: '2026-09-25T01:00:00.000Z',
};

describe('toApprovalDetailVM', () => {
  it('user.register 的 payload 收斂成 registration', () => {
    expect(toApprovalDetailVM(BASE)).toMatchObject({
      isPending: true,
      reason: '新進企劃',
      registration: { email: 'alice@example.com', displayName: 'Alice' },
    });
  });

  it('payload 欄位缺漏或型別不對時退回空字串，不讓畫面炸掉', () => {
    const vm = toApprovalDetailVM({ ...BASE, payload: { email: 42 } });
    expect(vm.registration).toEqual({ email: '', displayName: '' });
  });

  it('已審核時帶出審核結果', () => {
    const vm = toApprovalDetailVM({
      ...BASE,
      status: 'rejected',
      reviewerName: 'admin@example.com',
      reviewComment: '請改用公司信箱',
      reviewedAt: '2026-09-25T02:00:00.000Z',
    });
    expect(vm).toMatchObject({
      isPending: false,
      reviewerName: 'admin@example.com',
      reviewComment: '請改用公司信箱',
      reviewedAt: new Date('2026-09-25T02:00:00.000Z'),
    });
  });
});
