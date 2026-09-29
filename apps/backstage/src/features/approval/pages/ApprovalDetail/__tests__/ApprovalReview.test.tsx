import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import type { Role } from '@/shared/api-sdk';
import { renderUnhydrated, renderWithPermissions } from '@/test/renderWithPermissions';

import { registerApprovalPagePermissions } from '../../../permission';
import type { ApprovalDetailVM } from '../adapter';
import { ApprovalReviewActions } from '../components/ApprovalReviewActions';
import { ApprovalReviewForm } from '../components/ApprovalReviewForm';
import type { ApprovalReviewState } from '../useApprovalReview';

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

  it('點核准／駁回呼叫對應的動作', () => {
    const state = reviewState();
    renderWithPermissions(review(PENDING, state), REVIEWER);
    screen.getByTestId('approval-approve-button').click();
    screen.getByTestId('approval-reject-button').click();
    expect(state.approve).toHaveBeenCalledOnce();
    expect(state.reject).toHaveBeenCalledOnce();
  });
});
