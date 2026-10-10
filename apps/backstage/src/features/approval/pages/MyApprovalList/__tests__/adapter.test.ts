import { describe, expect, it } from 'vitest';

import type { ApprovalRequest } from '@/shared/api-sdk';

import { toMyApprovalRowVM } from '../adapter';

const DTO = {
  id: 'a1',
  type: 'user.register',
  status: 'pending',
  payload: {},
  requesterId: 'u1',
  requesterName: 'Carol',
  reason: null,
  reviewerId: null,
  reviewerName: null,
  reviewComment: null,
  reviewedAt: null,
  resultResourceId: null,
  flowVersion: 2,
  currentStep: { ordinal: 2, name: '人資' },
  stepCount: 3,
  resubmittedFrom: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} as unknown as ApprovalRequest;

describe('toMyApprovalRowVM（我的申請列表的一列）', () => {
  it('帶出類型、狀態、申請人，建立時間轉成 Date', () => {
    const vm = toMyApprovalRowVM(DTO, true);
    expect(vm).toMatchObject({
      id: 'a1',
      type: 'user.register',
      status: 'pending',
      requesterName: 'Carol',
    });
    expect(vm.createdAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
  });

  it('多階段：進度是目前的關卡，並帶總關卡數', () => {
    expect(toMyApprovalRowVM(DTO, true)).toMatchObject({
      progress: { ordinal: 2, name: '人資' },
      stepCount: 3,
    });
  });

  it('單關或已結束：進度為 null', () => {
    expect(
      toMyApprovalRowVM({ ...DTO, currentStep: null, stepCount: 0 }, true).progress,
    ).toBeNull();
  });

  it('多階段停用期間：照單關顯示，沒有進度與關卡數（docs/architecture/backend/20-approval.md §9.11）', () => {
    expect(toMyApprovalRowVM(DTO, false)).toMatchObject({ progress: null, stepCount: 0 });
  });
});
