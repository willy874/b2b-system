import { describe, expect, it } from 'vitest';

import type { ApprovalRequest } from '@/shared/api-sdk';

import { toApprovalRowVM } from '../adapter';

const BASE: ApprovalRequest = {
  id: 'a1',
  type: 'user.register',
  status: 'pending',
  payload: { email: 'alice@example.com', displayName: 'Alice' },
  requesterId: null,
  requesterName: 'alice@example.com',
  reason: null,
  reviewerId: null,
  reviewerName: null,
  reviewComment: null,
  reviewedAt: null,
  resultResourceId: null,
  createdAt: '2026-09-25T01:00:00.000Z',
  updatedAt: '2026-09-25T01:00:00.000Z',
};

describe('toApprovalRowVM', () => {
  it.each([
    ['pending', true],
    ['approved', false],
    ['rejected', false],
  ] as const)('%s → isPending = %s', (status, isPending) => {
    expect(toApprovalRowVM({ ...BASE, status }).isPending).toBe(isPending);
  });

  it('時間字串轉成 Date；未審核時 reviewedAt 為 null', () => {
    const vm = toApprovalRowVM(BASE);
    expect(vm.createdAt).toEqual(new Date('2026-09-25T01:00:00.000Z'));
    expect(vm.reviewedAt).toBeNull();
  });

  it('已審核時帶出審核者與審核時間', () => {
    const vm = toApprovalRowVM({
      ...BASE,
      status: 'approved',
      reviewerName: 'admin@example.com',
      reviewedAt: '2026-09-25T02:00:00.000Z',
    });
    expect(vm).toMatchObject({
      reviewerName: 'admin@example.com',
      reviewedAt: new Date('2026-09-25T02:00:00.000Z'),
    });
  });
});
