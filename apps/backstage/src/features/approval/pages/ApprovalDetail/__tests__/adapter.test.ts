import { describe, expect, it } from 'vitest';

import type { ApprovalRequestDetail } from '@/shared/api-sdk';

import { outcomeParams, toApprovalDetailVM, withoutChain } from '../adapter';

const BASE: ApprovalRequestDetail = {
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
  flowVersion: null,
  currentStep: null,
  stepCount: 0,
  resubmittedFrom: null,
  createdAt: '2026-09-25T01:00:00.000Z',
  updatedAt: '2026-09-25T01:00:00.000Z',
  steps: [],
  resubmittedTo: null,
  viewer: { canDecide: false, canOverride: false, canReviewSingle: true, canWithdraw: false },
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

describe('toApprovalDetailVM（多階段，docs/architecture/backend/20-approval.md §9）', () => {
  const STEP = {
    ordinal: 0,
    key: 'finance',
    name: '財務',
    assignee: { kind: 'group' as const, id: 'g1', label: '財務群組' },
    requiredMode: 'count' as const,
    required: 2,
    status: 'active' as const,
    shortage: null,
    closeReason: null,
    conditions: [],
    activatedAt: '2026-09-25T01:00:00.000Z',
    closedAt: null,
    candidates: [
      { userId: 'u1', name: 'F1' },
      { userId: 'u2', name: 'F2' },
    ],
    decisions: [
      {
        reviewerId: 'u1',
        reviewerName: 'F1',
        decision: 'approve' as const,
        via: 'assignee' as const,
        comment: null,
        decidedAt: '2026-09-25T02:00:00.000Z',
      },
    ],
  };

  it('同意數由決定算出；目前的關卡是 active 的那一關', () => {
    const vm = toApprovalDetailVM({
      ...BASE,
      steps: [STEP, { ...STEP, ordinal: 1, status: 'waiting', decisions: [] }],
    });
    expect(vm.steps.map((step) => step.approvals)).toEqual([1, 0]);
    expect(vm.currentStep?.ordinal).toBe(0);
  });

  it('關卡開始的時間與做決定的人（時間軸逐人對照候選人）', () => {
    const [step] = toApprovalDetailVM({ ...BASE, steps: [STEP] }).steps;
    expect(step?.activatedAt).toEqual(new Date('2026-09-25T01:00:00.000Z'));
    expect(step?.decisions[0]).toMatchObject({ reviewerId: 'u1', decision: 'approve' });
  });

  it('單關請求沒有關卡與目前的關卡', () => {
    const vm = toApprovalDetailVM(BASE);
    expect(vm.steps).toEqual([]);
    expect(vm.currentStep).toBeNull();
  });
});

const decision = (
  reviewerId: string,
  via: 'assignee' | 'legacy',
  verdict: 'approve' | 'reject',
) => ({
  reviewerId,
  reviewerName: reviewerId,
  decision: verdict,
  via,
  comment: null,
  decidedAt: '2026-09-25T02:00:00.000Z',
});
const step = (
  ordinal: number,
  status: 'waiting' | 'active' | 'approved' | 'skipped' | 'cancelled',
  decisions: ReturnType<typeof decision>[],
  extra: Partial<ApprovalRequestDetail['steps'][number]> = {},
): ApprovalRequestDetail['steps'][number] => ({
  ordinal,
  key: `k${ordinal}`,
  name: `第${ordinal}關`,
  assignee: { kind: 'group', id: 'g1', label: '財務群組' },
  requiredMode: 'count',
  required: 2,
  status,
  shortage: null,
  closeReason: null,
  conditions: [],
  activatedAt: null,
  closedAt: null,
  candidates: [
    { userId: 'u1', name: 'u1' },
    { userId: 'u2', name: 'u2' },
  ],
  decisions,
  ...extra,
});
describe('withoutChain（平台沒有啟用多階段，docs/architecture/backend/20-approval.md §9.11）', () => {
  const CHAIN_VIEWER = {
    canDecide: true,
    canOverride: true,
    canReviewSingle: true,
    canWithdraw: false,
  };

  it('進行中的多關請求 → 單關：沒有目前的關卡與之後的關卡，已通過的關卡與目前那一關已做的決定保留', () => {
    const vm = withoutChain(
      toApprovalDetailVM({
        ...BASE,
        viewer: CHAIN_VIEWER,
        steps: [
          step(0, 'approved', [
            decision('u1', 'assignee', 'approve'),
            decision('u2', 'assignee', 'approve'),
          ]),
          step(1, 'skipped', []),
          step(2, 'active', [decision('u1', 'assignee', 'approve')], { shortage: 'insufficient' }),
          step(3, 'waiting', []),
        ],
      }),
    );
    expect(vm.currentStep).toBeNull();
    expect(vm.steps.map(({ ordinal }) => ordinal)).toEqual([0]);
    expect(vm.singleReviewDecisions.map(({ reviewerId }) => reviewerId)).toEqual(['u1']);
    expect(vm.viewer).toEqual({ ...CHAIN_VIEWER, canDecide: false, canOverride: false });
  });

  it('停用期間一次定案的請求：被取消的那一關依決定顯示，不帶停用的標記', () => {
    const vm = withoutChain(
      toApprovalDetailVM({
        ...BASE,
        status: 'rejected',
        steps: [
          step(0, 'cancelled', [decision('u1', 'legacy', 'reject')], {
            closeReason: 'chainDisabled',
          }),
          step(1, 'cancelled', [], { closeReason: 'chainDisabled' }),
        ],
      }),
    );
    expect(vm.steps).toHaveLength(1);
    expect(vm.steps[0]).toMatchObject({ status: 'rejected', closeReason: null, required: null });
    expect(vm.steps[0]?.decisions[0]?.via).toBe('assignee');
  });

  it('單關請求照舊', () => {
    const vm = toApprovalDetailVM(BASE);
    expect(withoutChain(vm)).toBe(vm);
  });
});

const access = (payload: Record<string, unknown>): ApprovalRequestDetail => ({
  ...BASE,
  type: 'fileFolder.access',
  payload,
});

describe('toApprovalDetailVM（資料夾存取申請，docs/architecture/iam/06-resource-grants.md）', () => {
  it('fileFolder.access 的 payload 收斂成 folderAccess，沒有 registration', () => {
    const vm = toApprovalDetailVM(access({ folderId: 'f1', folderName: '合約', level: 'editor' }));
    expect(vm.folderAccess).toEqual({ folderId: 'f1', folderName: '合約', level: 'editor' });
    expect(vm.registration).toBeNull();
  });

  it('不認得的存取層級退回 viewer，資料夾名稱缺漏時是空字串', () => {
    expect(toApprovalDetailVM(access({ level: 'owner' })).folderAccess).toEqual({
      folderId: '',
      folderName: '',
      level: 'viewer',
    });
  });

  it('其他類型沒有 folderAccess', () => {
    expect(toApprovalDetailVM(BASE).folderAccess).toBeNull();
  });
});

describe('重新送出與結果句（docs/architecture/backend/20-approval.md §11.3）', () => {
  it('帶出申請人、前一筆與新的一筆', () => {
    const vm = toApprovalDetailVM({
      ...BASE,
      requesterId: 'u9',
      resubmittedFrom: 'a0',
      resubmittedTo: 'a2',
    });
    expect(vm).toMatchObject({ requesterId: 'u9', resubmittedFrom: 'a0', resubmittedTo: 'a2' });
  });

  it('結果句的參數依類型取出', () => {
    expect(outcomeParams(toApprovalDetailVM(BASE))).toEqual({ email: 'alice@example.com' });
    expect(
      outcomeParams(
        toApprovalDetailVM(access({ folderId: 'f1', folderName: '合約', level: 'editor' })),
      ),
    ).toEqual({ folder: '合約', level: 'editor' });
  });
});
