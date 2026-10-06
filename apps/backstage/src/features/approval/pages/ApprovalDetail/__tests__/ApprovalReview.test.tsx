import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute, renderUnhydrated, renderWithPermissions } from '@b2b-system/web-core/testing';
import { Outlet } from '@tanstack/react-router';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import type { ApprovalRequest, Role } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { Routes } from '../../..';
import approvalZhTW from '../../../locales/zh_TW.json';
import { registerApprovalPagePermissions } from '../../../permission';
import type { ApprovalDetailVM } from '../adapter';
import { ApprovalReviewActions } from '../components/ApprovalReviewActions';
import { ApprovalReviewForm } from '../components/ApprovalReviewForm';
import type { ApprovalReviewState } from '../useApprovalReview';

const { fetchDetail, approve, reject } = vi.hoisted(() => ({
  fetchDetail: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));
vi.mock('@/apis/approval/get-approval-detail/fetcher', () => ({
  fetchApprovalDetailQuery: fetchDetail,
}));
vi.mock('@/apis/approval/approve-approval/fetcher', () => ({
  fetchApproveApprovalMutation: approve,
}));
vi.mock('@/apis/approval/reject-approval/fetcher', () => ({
  fetchRejectApprovalMutation: reject,
}));

const PENDING: ApprovalDetailVM = {
  id: 'a1',
  type: 'user.register',
  status: 'pending',
  isPending: true,
  requesterName: 'alice@example.com',
  reason: null,
  createdAt: new Date('2026-09-25T01:00:00.000Z'),
  reviewerName: null,
  reviewComment: null,
  reviewedAt: null,
  folderAccess: null,
  registration: { email: 'alice@example.com', displayName: 'Alice' },
};

const ROLES = [{ id: 'role-member', slug: 'member', name: '一般成員' }] as Role[];

const REVIEWER = [
  PermissionKey['approval:read'],
  PermissionKey['approval:review'],
  PermissionKey['user:create'],
];

function reviewState(): ApprovalReviewState {
  return {
    isDirty: false,
    roleIds: [],
    setRoleIds: vi.fn(),
    comment: '',
    setComment: vi.fn(),
    error: undefined,
    isPending: false,
    isApproving: false,
    isRejecting: false,
    approve: vi.fn(async () => undefined),
    reject: vi.fn(async () => undefined),
  };
}

const review = (approval: ApprovalDetailVM = PENDING, state = reviewState()) => (
  <>
    <ApprovalReviewForm approval={approval} review={state} roleOptions={ROLES} />
    <ApprovalReviewActions approval={approval} review={state} />
  </>
);

beforeAll(() => initTestI18n(approvalZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalPagePermissions();
});

describe('審核操作（UI gating 的三個案例）', () => {
  it('有審核權限 → 顯示審核欄位與核准、駁回', () => {
    renderWithPermissions(review(), REVIEWER);
    expect(screen.getByTestId('approval-review-form')).toBeInTheDocument();
    expect(screen.getByTestId('approval-approve-button')).toBeEnabled();
    expect(screen.getByTestId('approval-reject-button')).toBeEnabled();
    expect(screen.queryByTestId('approval-approve-hint')).not.toBeInTheDocument();
  });

  it('沒有 approval:review → 不渲染審核欄位與按鈕', () => {
    renderWithPermissions(review(), [PermissionKey['approval:read'], PermissionKey['user:create']]);
    expect(screen.queryByTestId('approval-review-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('approval-approve-button')).not.toBeInTheDocument();
  });

  it('權限尚未水合 → 不閃現審核操作', () => {
    renderUnhydrated(review());
    expect(screen.queryByTestId('approval-review-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('approval-reject-button')).not.toBeInTheDocument();
  });
});

describe('審核操作（依類型要求的權限）', () => {
  it('有審核權但沒有 user:create → 核准停用並說明原因，駁回仍可用', () => {
    renderWithPermissions(review(), [
      PermissionKey['approval:read'],
      PermissionKey['approval:review'],
    ]);
    expect(screen.getByTestId('approval-approve-button')).toBeDisabled();
    expect(screen.getByTestId('approval-approve-hint')).toBeInTheDocument();
    expect(screen.getByTestId('approval-reject-button')).toBeEnabled();
  });

  it('能指派角色（user:assignRole ＋ role:read）時才顯示角色選單', () => {
    const { unmount } = renderWithPermissions(review(), [
      ...REVIEWER,
      PermissionKey['user:assignRole'],
      PermissionKey['role:read'],
    ]);
    expect(screen.getByTestId('approval-role-select')).toBeInTheDocument();
    unmount();

    renderWithPermissions(review(), REVIEWER);
    expect(screen.queryByTestId('approval-role-select')).not.toBeInTheDocument();
  });

  it('已審核的請求 → 不渲染審核操作', () => {
    renderWithPermissions(review({ ...PENDING, status: 'approved', isPending: false }), REVIEWER);
    expect(screen.queryByTestId('approval-review-form')).not.toBeInTheDocument();
    expect(screen.queryByTestId('approval-approve-button')).not.toBeInTheDocument();
  });

  it('點核准呼叫核准', () => {
    const state = reviewState();
    renderWithPermissions(review(PENDING, state), REVIEWER);
    screen.getByTestId('approval-approve-button').click();
    expect(state.approve).toHaveBeenCalledOnce();
  });

  it('核准或駁回失敗的訊息在 role="alert" 裡（docs/architecture/frontend/07-ui-system.md §5）', () => {
    renderWithPermissions(
      review(PENDING, { ...reviewState(), error: '這筆申請已經被審核過了' }),
      REVIEWER,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('這筆申請已經被審核過了');
  });

  it('駁回無法撤回：先確認；按取消不送出，按確認才駁回', async () => {
    const state = reviewState();
    renderWithPermissions(review(PENDING, state), REVIEWER);

    fireEvent.click(screen.getByTestId('approval-reject-button'));
    const confirm = await screen.findByTestId('approval-reject-confirm');
    expect(confirm).toHaveTextContent('alice@example.com');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('approval-reject-confirm')).toBeNull());
    expect(state.reject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('approval-reject-button'));
    fireEvent.click(
      within(await screen.findByTestId('approval-reject-confirm')).getByTestId(
        'alert-dialog-confirm',
      ),
    );
    await waitFor(() => expect(state.reject).toHaveBeenCalledOnce());
  });
});

describe('審批詳情（路由對話框）的未儲存提醒', () => {
  // 列表換成只渲染子路由：這裡只測詳情對話框
  Routes.ApprovalListRoute.update({ component: Outlet });
  const routes = [Routes.ApprovalListRoute.addChildren([Routes.ApprovalDetailRoute])];
  const DTO: ApprovalRequest = {
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

  beforeEach(() => {
    fetchDetail.mockReset().mockResolvedValue(DTO);
    approve.mockReset().mockResolvedValue({ ...DTO, status: 'approved' });
    reject.mockReset().mockResolvedValue({ ...DTO, status: 'rejected' });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });

  async function openWithComment() {
    const result = renderRoute(routes, '/approval/a1', REVIEWER);
    const input = await screen.findByTestId('approval-comment-input', undefined, {
      timeout: 5000,
    });
    fireEvent.change(input, { target: { value: '資料齊全' } });
    return { ...result, input };
  }

  it('輸入意見後按關閉：先確認；選「繼續編輯」後意見還在', async () => {
    const { router } = await openWithComment();
    fireEvent.click(screen.getByTestId('approval-detail-close'));

    const confirm = await screen.findByTestId('unsaved-changes-confirm');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
    expect(router.state.location.pathname).toBe('/approval/a1');
    expect(screen.getByTestId('approval-comment-input')).toHaveValue('資料齊全');
  });

  it('輸入意見後按 Esc：先確認', async () => {
    const { input } = await openWithComment();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(await screen.findByTestId('unsaved-changes-confirm')).toBeInTheDocument();
  });

  it('沒有輸入時按關閉：直接回列表', async () => {
    const { router } = renderRoute(routes, '/approval/a1', REVIEWER);
    fireEvent.click(
      await screen.findByTestId('approval-detail-close', undefined, { timeout: 5000 }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/approval'));
    expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
  });

  it('審核成功後關閉：不確認', async () => {
    const { router } = await openWithComment();
    fireEvent.click(screen.getByTestId('approval-approve-button'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/approval'));
    expect(approve).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
  });

  it('審批已不存在（例：從通知點進來）→ 說明原因並提供回到列表，不提供重試', async () => {
    fetchDetail.mockRejectedValue(new AppError('APPROVAL_NOT_FOUND', 404));
    const { router } = renderRoute(routes, '/approval/a1', REVIEWER);

    expect(
      await screen.findByTestId('approval-detail-error', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('query-error-retry')).toBeNull();
    fireEvent.click(screen.getByTestId('approval-detail-back'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/approval'));
  });

  it('查詢失敗（500）→ 顯示錯誤與重試；重試成功後顯示內容', async () => {
    fetchDetail.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, '/approval/a1', REVIEWER);

    expect(
      await screen.findByTestId('approval-detail-error', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    fetchDetail.mockResolvedValue(DTO);
    fireEvent.click(screen.getByTestId('query-error-retry'));
    expect(await screen.findByTestId('approval-review-form')).toBeInTheDocument();
  });
});
