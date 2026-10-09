import { renderUnhydrated, renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import approvalZhTW from '../../../locales/zh_TW.json';
import { registerApprovalPagePermissions } from '../../../permission';
import type { ApprovalDetailVM, ApprovalStepVM } from '../adapter';
import { ApprovalChainActions } from '../components/ApprovalChainActions';
import { ApprovalOverrideActions } from '../components/ApprovalOverrideActions';
import { ApprovalStatusBanner } from '../components/ApprovalStatusBanner';
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
  activatedAt: new Date('2026-10-01T01:00:00.000Z'),
  candidates: [
    { userId: 'u1', name: 'F1' },
    { userId: 'u2', name: 'F2' },
  ],
  decisions: [
    {
      reviewerId: 'u1',
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
    requesterId: 'carl',
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
    resubmittedFrom: null,
    resubmittedTo: null,
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
      <ApprovalOverrideActions approval={approval({ canOverride: true })} review={reviewState()} />,
      [],
    );
    expect(screen.getByTestId('approval-override-approve-button')).toBeDisabled();
    expect(screen.getByTestId('approval-refresh-button')).toBeEnabled();
  });

  it('override：確認後以目前的關卡送出', async () => {
    const state = reviewState('群組設定錯誤');
    renderWithPermissions(
      <ApprovalOverrideActions approval={approval({ canOverride: true })} review={state} />,
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
    renderUnhydrated(
      <>
        <ApprovalChainActions approval={approval({})} review={reviewState()} />
        <ApprovalOverrideActions approval={approval({})} review={reviewState()} />
      </>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('管理員操作與審核者的決定分開：只有 override 權限時沒有同意／駁回', () => {
    renderWithPermissions(
      <>
        <ApprovalChainActions approval={approval({ canOverride: true })} review={reviewState()} />
        <ApprovalOverrideActions
          approval={approval({ canOverride: true })}
          review={reviewState()}
        />
      </>,
      [],
    );
    expect(screen.getByTestId('approval-override-actions')).toBeInTheDocument();
    expect(screen.queryByTestId('approval-step-approve-button')).not.toBeInTheDocument();
  });
});

describe('審核流程（docs/architecture/backend/20-approval.md §11.3）', () => {
  it('每一關的狀態與同意數；目前的關卡逐人列出已同意與尚未動作，附上意見', () => {
    renderWithPermissions(<ApprovalTimeline approval={approval({})} />, []);
    const finance = screen
      .getAllByTestId('approval-step')
      .find((element) => element.dataset.value === '1') as HTMLElement;
    expect(finance).toHaveAttribute('data-status', 'active');
    expect(finance).toHaveTextContent('1／2 已同意');
    const people = within(finance).getAllByTestId('approval-step-person');
    expect(people.map((person) => [person.dataset.value, person.dataset.state])).toEqual([
      ['F1', 'approve'],
      ['F2', 'pending'],
    ]);
    expect(people[0]).toHaveTextContent('預算內');
    expect(people[1]).toHaveTextContent('尚未動作');
  });

  it('已結束的關卡不列出沒做決定的人', () => {
    renderWithPermissions(<ApprovalTimeline approval={approval({})} />, []);
    const manager = screen
      .getAllByTestId('approval-step')
      .find((element) => element.dataset.value === '0') as HTMLElement;
    expect(
      within(manager)
        .getAllByTestId('approval-step-person')
        .map((person) => person.dataset.state),
    ).toEqual(['approve']);
  });

  it('找不到審核者時標示', () => {
    const stuck = { ...STEP, shortage: 'noCandidate' as const, candidates: [], decisions: [] };
    renderWithPermissions(
      <ApprovalTimeline approval={{ ...approval({}), steps: [stuck], currentStep: stuck }} />,
      [],
    );
    expect(screen.getByTestId('approval-step-shortage')).toHaveTextContent('找不到審核者');
  });

  it('單關請求以一個「審核」節點表示；最後一個節點說明核准後會怎樣', () => {
    renderWithPermissions(
      <ApprovalTimeline approval={{ ...approval({}), steps: [], currentStep: null }} />,
      [],
    );
    expect(screen.getByTestId('approval-flow-single')).toHaveAttribute('data-state', 'current');
    expect(screen.getByTestId('approval-flow-outcome')).toHaveTextContent(
      '核准後會建立帳號 new@example.com 並寄出啟用信。',
    );
  });
});

describe('狀態橫幅（docs/architecture/backend/20-approval.md §11.3）', () => {
  const open = vi.fn();

  it('等待目前的關卡；輪到我時說明', () => {
    renderWithPermissions(
      <ApprovalStatusBanner
        approval={approval({ canDecide: true })}
        isRequester={false}
        onOpenApproval={open}
      />,
      [],
    );
    expect(screen.getByTestId('approval-status-headline')).toHaveTextContent(
      '等待第 2 關「財務」：1／2 已同意',
    );
    expect(screen.getByTestId('approval-status-banner')).toHaveTextContent('輪到你審核');
  });

  it('找不到審核者：以危險色標示，有 override 權限時指向管理員操作', () => {
    const stuck = { ...STEP, shortage: 'noCandidate' as const };
    renderWithPermissions(
      <ApprovalStatusBanner
        approval={{ ...approval({ canOverride: true }), currentStep: stuck, steps: [stuck] }}
        isRequester={false}
        onOpenApproval={open}
      />,
      [],
    );
    expect(screen.getByTestId('approval-status-banner')).toHaveAttribute('data-value', 'danger');
    expect(screen.getByTestId('approval-status-banner')).toHaveTextContent('管理員操作');
  });

  it('已核准：說明結果', () => {
    renderWithPermissions(
      <ApprovalStatusBanner
        approval={{ ...approval({}), status: 'approved', isPending: false }}
        isRequester={false}
        onOpenApproval={open}
      />,
      [],
    );
    expect(screen.getByTestId('approval-status-banner')).toHaveTextContent(
      '已建立帳號 new@example.com',
    );
  });

  it('已重新送出：可以打開新的一筆', () => {
    renderWithPermissions(
      <ApprovalStatusBanner
        approval={{ ...approval({}), status: 'rejected', isPending: false, resubmittedTo: 'a2' }}
        isRequester
        onOpenApproval={open}
      />,
      [],
    );
    fireEvent.click(screen.getByTestId('approval-resubmitted-to'));
    expect(open).toHaveBeenCalledWith('a2');
    expect(screen.queryByTestId('approval-resubmit-link')).not.toBeInTheDocument();
  });
});
