import { renderUnhydrated, renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import approvalZhTW from '../../../locales/zh_TW.json';
import { registerApprovalPagePermissions } from '../../../permission';
import type { ApprovalDetailVM, ApprovalStepVM } from '../adapter';
import { ApprovalChainActions } from '../components/ApprovalChainActions';
import { ApprovalTimeline } from '../components/ApprovalTimeline';
import type { ApprovalReviewState } from '../useApprovalReview';

const STEP: ApprovalStepVM = {
  ordinal: 1,
  name: '財務',
  status: 'active',
  assignee: { kind: 'group', id: 'g1', label: '財務群組' },
  required: 2,
  approvals: 1,
  shortage: null,
  closeReason: null,
  candidates: [
    { userId: 'u1', name: 'F1' },
    { userId: 'u2', name: 'F2' },
  ],
  decisions: [
    {
      reviewerName: 'F1',
      decision: 'approve',
      via: 'assignee',
      comment: '預算內',
      decidedAt: new Date('2026-10-01T02:00:00.000Z'),
    },
  ],
};

const NO_ACTIONS = {
  canDecide: false,
  canOverride: false,
  canReviewSingle: false,
  canWithdraw: false,
};

function approval(viewer: Partial<ApprovalDetailVM['viewer']>): ApprovalDetailVM {
  return {
    id: 'a1',
    type: 'user.register',
    status: 'pending',
    isPending: true,
    requesterName: 'carl@example.com',
    reason: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    reviewerName: null,
    reviewComment: null,
    reviewedAt: null,
    registration: { email: 'new@example.com', displayName: 'New' },
    folderAccess: null,
    steps: [{ ...STEP, ordinal: 0, name: '部門主管', status: 'approved' }, STEP],
    currentStep: STEP,
    viewer: { ...NO_ACTIONS, ...viewer },
  };
}

function reviewState(comment = ''): ApprovalReviewState {
  return {
    isDirty: false,
    roleIds: [],
    setRoleIds: vi.fn(),
    comment,
    setComment: vi.fn(),
    error: undefined,
    isPending: false,
    isApproving: false,
    isRejecting: false,
    isOverriding: false,
    isRefreshing: false,
    isWithdrawing: false,
    approve: vi.fn(async () => undefined),
    reject: vi.fn(async () => undefined),
    decide: vi.fn(async () => undefined),
    override: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    withdraw: vi.fn(async () => undefined),
  };
}

beforeAll(() => initTestI18n(approvalZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalPagePermissions();
});

describe('多階段的操作（docs/architecture/backend/20-approval.md §9.7～§9.9）', () => {
  it('目前關卡的審核者：同意送出這一關的決定', () => {
    const state = reviewState();
    renderWithPermissions(
      <ApprovalChainActions approval={approval({ canDecide: true })} review={state} />,
      [],
    );
    fireEvent.click(screen.getByTestId('approval-step-approve-button'));
    expect(state.decide).toHaveBeenCalledWith(1, 'approve');
    expect(screen.queryByTestId('approval-override-approve-button')).not.toBeInTheDocument();
  });

  it('override：沒有審核意見時停用（強制定案要留下理由）；有意見時確認後送出', async () => {
    renderWithPermissions(
      <ApprovalChainActions approval={approval({ canOverride: true })} review={reviewState()} />,
      [],
    );
    expect(screen.getByTestId('approval-override-approve-button')).toBeDisabled();
    expect(screen.getByTestId('approval-refresh-button')).toBeEnabled();
  });

  it('override：確認後以目前的關卡送出', async () => {
    const state = reviewState('群組設定錯誤');
    renderWithPermissions(
      <ApprovalChainActions approval={approval({ canOverride: true })} review={state} />,
      [],
    );
    fireEvent.click(screen.getByTestId('approval-override-approve-button'));
    fireEvent.click(
      within(await screen.findByTestId('approval-chain-confirm')).getByTestId(
        'alert-dialog-confirm',
      ),
    );
    await waitFor(() => expect(state.override).toHaveBeenCalledWith(1, 'approve'));
  });

  it('申請人：可以撤回', async () => {
    const state = reviewState();
    renderWithPermissions(
      <ApprovalChainActions approval={approval({ canWithdraw: true })} review={state} />,
      [],
    );
    fireEvent.click(screen.getByTestId('approval-withdraw-button'));
    fireEvent.click(
      within(await screen.findByTestId('approval-chain-confirm')).getByTestId(
        'alert-dialog-confirm',
      ),
    );
    await waitFor(() => expect(state.withdraw).toHaveBeenCalledOnce());
  });

  it('後端說什麼都不能做 → 沒有任何按鈕（未水合也一樣）', () => {
    renderUnhydrated(<ApprovalChainActions approval={approval({})} review={reviewState()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('關卡時間軸', () => {
  it('每一關的狀態、同意數、審核者與意見', () => {
    renderWithPermissions(<ApprovalTimeline steps={approval({}).steps} />, []);
    const finance = screen
      .getAllByTestId('approval-step')
      .find((element) => element.dataset.value === '1');
    expect(finance).toHaveAttribute('data-status', 'active');
    expect(within(finance as HTMLElement).getByTestId('approval-step-count')).toHaveTextContent(
      '1／2',
    );
    expect(
      within(finance as HTMLElement).getByTestId('approval-step-candidates'),
    ).toHaveTextContent('F1、F2');
    expect(finance).toHaveTextContent('預算內');
  });

  it('找不到審核者時標示', () => {
    renderWithPermissions(
      <ApprovalTimeline steps={[{ ...STEP, shortage: 'noCandidate', candidates: [] }]} />,
      [],
    );
    expect(screen.getByTestId('approval-step-shortage')).toHaveTextContent('找不到審核者');
  });

  it('單關請求不顯示', () => {
    renderWithPermissions(<ApprovalTimeline steps={[]} />, []);
    expect(screen.queryByTestId('approval-timeline')).not.toBeInTheDocument();
  });
});
