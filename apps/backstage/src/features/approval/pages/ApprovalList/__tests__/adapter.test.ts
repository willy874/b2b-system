import { describe, expect, it } from 'vitest';

import type { ApprovalRequest } from '@/shared/api-sdk';

import { toApprovalListParams, toApprovalRowVM } from '../adapter';

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
  flowVersion: null,
  currentStep: null,
  stepCount: 0,
  resubmittedFrom: null,
  createdAt: '2026-09-25T01:00:00.000Z',
  updatedAt: '2026-09-25T01:00:00.000Z',
};

const REVIEWER = { canReview: true, canApproveRegistration: true, chainEnabled: true };

describe('toApprovalRowVM', () => {
  it.each([
    ['pending', true],
    ['approved', false],
    ['rejected', false],
  ] as const)('%s → isPending = %s', (status, isPending) => {
    expect(toApprovalRowVM({ ...BASE, status }, REVIEWER).isPending).toBe(isPending);
  });

  it('時間字串轉成 Date；未審核時 reviewedAt 為 null', () => {
    const vm = toApprovalRowVM(BASE, REVIEWER);
    expect(vm.createdAt).toEqual(new Date('2026-09-25T01:00:00.000Z'));
    expect(vm.reviewedAt).toBeNull();
  });

  it('已審核時帶出審核者與審核時間', () => {
    const vm = toApprovalRowVM(
      {
        ...BASE,
        status: 'approved',
        reviewerName: 'admin@example.com',
        reviewedAt: '2026-09-25T02:00:00.000Z',
      },
      REVIEWER,
    );
    expect(vm).toMatchObject({
      reviewerName: 'admin@example.com',
      reviewedAt: new Date('2026-09-25T02:00:00.000Z'),
    });
  });

  it.each([
    ['待審 ＋ 完整權限', 'pending', REVIEWER, { canReview: true, canApprove: true }],
    [
      '待審 ＋ 只有審核權（沒有 user:create）',
      'pending',
      { canReview: true, canApproveRegistration: false, chainEnabled: true },
      { canReview: true, canApprove: false },
    ],
    [
      '待審 ＋ 沒有審核權',
      'pending',
      { canReview: false, canApproveRegistration: false, chainEnabled: true },
      { canReview: false, canApprove: false },
    ],
    ['已審核', 'rejected', REVIEWER, { canReview: false, canApprove: false }],
  ] as const)('快速審核旗標：%s', (_, status, permission, expected) => {
    expect(toApprovalRowVM({ ...BASE, status }, permission)).toMatchObject(expected);
  });
});

describe('toApprovalRowVM（多階段，docs/architecture/backend/20-approval.md §9.11）', () => {
  const inChain = {
    ...BASE,
    currentStep: {
      ordinal: 1,
      name: '財務',
      approvals: 1,
      required: 2,
      shortage: null,
      activatedAt: '2026-10-01T00:00:00.000Z',
      pendingReviewers: ['F2'],
      pendingCount: 1,
    },
    stepCount: 3,
  };

  it('進行中的多關請求不能快速審核（要在關卡上決定），但帶出進度', () => {
    const vm = toApprovalRowVM(inChain, REVIEWER);
    expect(vm).toMatchObject({ canReview: false, canApprove: false, stepCount: 3 });
    expect(vm.progress).toMatchObject({ name: '財務', approvals: 1, required: 2 });
  });

  it('多階段停用期間：多關請求改由單關的核准／駁回一次定案，不顯示關卡的進度', () => {
    expect(toApprovalRowVM(inChain, { ...REVIEWER, chainEnabled: false })).toMatchObject({
      canReview: true,
      canApprove: true,
      progress: null,
      stepCount: 0,
    });
  });
});

describe('toApprovalListParams（列表與詳情的「下一筆」用同一份清單）', () => {
  it('狀態 all 不篩選；其他狀態與類型轉成陣列', () => {
    const base = { offset: 20, limit: 20, sort: [] };
    expect(toApprovalListParams({ ...base, status: 'all' })).toMatchObject({
      offset: 20,
      status: undefined,
      type: undefined,
    });
    expect(
      toApprovalListParams({ ...base, status: 'pending', type: 'fileFolder.access', keyword: 'a' }),
    ).toMatchObject({ status: ['pending'], type: ['fileFolder.access'], keyword: 'a' });
  });
});
