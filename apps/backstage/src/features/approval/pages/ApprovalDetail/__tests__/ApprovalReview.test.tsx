import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute, renderUnhydrated, renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import type { ApprovalRequestDetail, Role } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { Routes } from '../../..';
import approvalZhTW from '../../../locales/zh_TW.json';
import { registerApprovalPagePermissions } from '../../../permission';
import type { ApprovalDetailVM } from '../adapter';
import { ApprovalReviewActions } from '../components/ApprovalReviewActions';
import { ApprovalReviewForm } from '../components/ApprovalReviewForm';
import { ApprovalSummary } from '../components/ApprovalSummary';
import type { ApprovalReviewState } from '../useApprovalReview';

const { fetchDetail, fetchList, approve, reject } = vi.hoisted(() => ({
  fetchDetail: vi.fn(),
  fetchList: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));
vi.mock('@/apis/approval/get-approval-detail/fetcher', () => ({
  fetchApprovalDetailQuery: fetchDetail,
}));
vi.mock('@/apis/approval/get-approval-list/fetcher', () => ({
  fetchApprovalListQuery: fetchList,
}));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({
  fetchProfileQuery: vi.fn(async () => ({ user: { id: 'reviewer' }, roles: [], permissions: [] })),
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
  steps: [],
  currentStep: null,
  viewer: { canDecide: false, canOverride: false, canReviewSingle: true, canWithdraw: false },
  requesterId: null,
  resubmittedFrom: null,
  resubmittedTo: null,
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

describe('申請內容', () => {
  it('註冊申請的 email 標示「尚未驗證」：核准後才由啟用信驗證', () => {
    renderWithPermissions(<ApprovalSummary approval={PENDING} />, REVIEWER);
    expect(screen.getByTestId('approval-email-unverified')).toHaveTextContent('尚未驗證');
  });

  it('資料夾存取申請沒有 email，不標示', () => {
    renderWithPermissions(
      <ApprovalSummary
        approval={{
          ...PENDING,
          type: 'fileFolder.access',
          registration: null,
          folderAccess: { folderId: 'f1', folderName: '設計稿', level: 'viewer' },
        }}
      />,
      REVIEWER,
    );
    expect(screen.queryByTestId('approval-email-unverified')).not.toBeInTheDocument();
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

describe('審批詳情（整頁，docs/architecture/backend/20-approval.md §11.3）', () => {
  // 列表只留一個標記：這裡只測詳情頁
  Routes.ApprovalListRoute.update({ component: () => <div data-testid="approval-list-stub" /> });
  const routes = [Routes.ApprovalListRoute, Routes.ApprovalDetailRoute];
  const DTO: ApprovalRequestDetail = {
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
    steps: [],
    viewer: { canDecide: false, canOverride: false, canReviewSingle: true, canWithdraw: false },
    resubmittedTo: null,
  };
  const page = (ids: string[]) => ({
    items: ids.map((id) => ({ ...DTO, id })),
    pagination: { offset: 0, limit: 20, total: ids.length },
  });

  beforeEach(() => {
    fetchDetail.mockReset().mockImplementation(async ({ params }) => ({
      ...DTO,
      id: params.approvalId,
    }));
    fetchList.mockReset();
    approve.mockReset().mockResolvedValue({ ...DTO, status: 'approved' });
    reject.mockReset().mockResolvedValue({ ...DTO, status: 'rejected' });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  });

  async function openWithComment(path = '/approval/a1') {
    const result = renderRoute(routes, path, REVIEWER);
    const input = await screen.findByTestId('approval-comment-input', undefined, {
      timeout: 5000,
    });
    fireEvent.change(input, { target: { value: '資料齊全' } });
    return { ...result, input };
  }

  it('輸入意見後按「回到列表」：先確認；選「繼續編輯」後意見還在', async () => {
    const { router } = await openWithComment();
    fireEvent.click(screen.getByTestId('approval-detail-back'));

    const confirm = await screen.findByTestId('unsaved-changes-confirm');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
    expect(router.state.location.pathname).toBe('/approval/a1');
    expect(screen.getByTestId('approval-comment-input')).toHaveValue('資料齊全');
  });

  it('沒有輸入時按「回到列表」：直接回列表，帶著原本的篩選', async () => {
    const { router } = renderRoute(routes, '/approval/a1?status=rejected', REVIEWER);
    fireEvent.click(
      await screen.findByTestId('approval-detail-back', undefined, { timeout: 5000 }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/approval'));
    expect(router.state.location.search).toMatchObject({ status: 'rejected' });
    expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
  });

  it('從通知或網址直接進來：審核成功後留在原頁、表單清空，不確認', async () => {
    const { router } = await openWithComment();
    fireEvent.click(screen.getByTestId('approval-approve-button'));

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('approval-comment-input')).toHaveValue(''));
    expect(router.state.location.pathname).toBe('/approval/a1');
    expect(fetchList).not.toHaveBeenCalled();
    expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
  });

  it('從待審清單進來（queue）：審核成功後前往清單裡的下一筆，不確認（§12 D5）', async () => {
    fetchList.mockResolvedValue(page(['a2', 'a3']));
    const { router } = await openWithComment('/approval/a1?queue=true');
    fireEvent.click(screen.getByTestId('approval-approve-button'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/approval/a2'));
    expect(fetchList).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ status: ['pending'] }) }),
    );
    expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
    // 下一筆的表單是新的
    expect(await screen.findByTestId('approval-comment-input')).toHaveValue('');
  });

  it('清單裡沒有下一筆：回到列表', async () => {
    fetchList.mockResolvedValue(page([]));
    const { router } = await openWithComment('/approval/a1?queue=true');
    fireEvent.click(screen.getByTestId('approval-approve-button'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/approval'));
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
