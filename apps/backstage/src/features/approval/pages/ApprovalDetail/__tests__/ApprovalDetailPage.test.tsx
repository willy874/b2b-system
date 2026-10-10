import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PermissionKey, resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import type { ApprovalRequestDetail } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { registerApprovalPagePermissions, Routes } from '../../..';
import approvalZhTW from '../../../locales/zh_TW.json';

const { fetchDetail, fetchList, approve } = vi.hoisted(() => ({
  fetchDetail: vi.fn(),
  fetchList: vi.fn(),
  approve: vi.fn(),
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

const DTO: ApprovalRequestDetail = {
  id: 'a1',
  type: 'fileFolder.access',
  status: 'pending',
  payload: { folderId: 'f1', folderName: '設計稿', level: 'viewer' },
  requesterId: 'u-alice',
  requesterName: 'Alice',
  reason: '要看設計稿',
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

const REVIEWER = [PermissionKey['approval:read'], PermissionKey['approval:review']];

// 列表只留一個標記：這裡只測詳情頁與返回的去向
Routes.ApprovalListRoute.update({ component: () => <div data-testid="approval-list-stub" /> });
const routes = [Routes.ApprovalListRoute, Routes.ApprovalDetailRoute];

beforeAll(() => initTestI18n(approvalZhTW));

beforeEach(() => {
  vi.clearAllMocks();
  resetPagePermissionRegistry();
  registerApprovalPagePermissions();
  fetchDetail.mockImplementation(async ({ params }) => ({ ...DTO, id: params.approvalId }));
  fetchList.mockResolvedValue(page([]));
  approve.mockResolvedValue({ ...DTO, status: 'approved' });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('審批詳情的頁面權限（頁面鍵落在審批列表 /approval 的前綴上）', () => {
  it('有 approval:read → 進得去，渲染整個詳情', async () => {
    usePermissionStore.setState({ permissions: new Set(REVIEWER), hydrated: true });
    expect(renderHook(() => usePageAccess('/approval/a1')).result.current).toMatchObject({
      gated: true,
      canAccess: true,
    });

    renderRoute(routes, '/approval/a1', REVIEWER);
    await waitFor(
      () => expect(screen.getByTestId('approval-detail-title')).toHaveTextContent('資料夾存取申請'),
      { timeout: 5000 },
    );
    expect(screen.getByTestId('approval-detail-status-chip')).toHaveAttribute(
      'data-value',
      'pending',
    );
    expect(screen.getByText('設計稿')).toBeInTheDocument();
    expect(screen.getByTestId('approval-status-banner')).toBeInTheDocument();
    expect(screen.getByTestId('approval-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('approval-action-panel')).toBeInTheDocument();
    expect(screen.getByTestId('approval-detail-back')).toHaveTextContent('回到審批列表');
    expect(fetchDetail).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ approvalId: 'a1' }) }),
    );
  });

  it('沒有 approval:read → 不能進（「我的審批」的詳情不受影響）', () => {
    usePermissionStore.setState({
      permissions: new Set([PermissionKey['user:read']]),
      hydrated: true,
    });
    expect(renderHook(() => usePageAccess('/approval/a1')).result.current).toMatchObject({
      gated: true,
      canAccess: false,
    });
    expect(renderHook(() => usePageAccess('/my-approvals/a1')).result.current).toMatchObject({
      canAccess: true,
    });
  });

  it('權限未水合 → 還不能判斷，也不閃現審核操作', async () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => usePageAccess('/approval/a1')).result.current).toMatchObject({
      hydrated: false,
      gated: true,
    });

    renderRoute(routes, '/approval/a1', 'unhydrated');
    await waitFor(
      () => expect(screen.getByTestId('approval-detail-title')).toHaveTextContent('資料夾存取申請'),
      { timeout: 5000 },
    );
    expect(screen.queryByTestId('approval-action-panel')).toBeNull();
  });
});

describe('審批詳情頁的返回與「下一筆」（docs/architecture/backend/20-approval.md §11.3、§12 D5）', () => {
  it('「回到審批列表」回到 /approval，帶著原本的篩選、不帶 queue', async () => {
    const { router } = renderRoute(
      routes,
      '/approval/a1?status=all&type=fileFolder.access&keyword=Alice&queue=true',
      REVIEWER,
    );
    fireEvent.click(
      await screen.findByTestId('approval-detail-back', undefined, { timeout: 5000 }),
    );

    expect(await screen.findByTestId('approval-list-stub')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/approval');
    expect(router.state.location.search).toEqual({
      status: 'all',
      type: 'fileFolder.access',
      keyword: 'Alice',
    });
  });

  it('從待審清單進來（queue）：以列表的篩選、scope=all 找下一筆，下一筆仍帶著篩選與 queue', async () => {
    fetchList.mockResolvedValue(page(['a2']));
    const { router } = renderRoute(
      routes,
      '/approval/a1?status=all&type=fileFolder.access&queue=true',
      REVIEWER,
    );
    fireEvent.click(
      await screen.findByTestId('approval-approve-button', undefined, { timeout: 5000 }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe('/approval/a2'));
    expect(fetchList).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          scope: 'all',
          status: undefined,
          type: ['fileFolder.access'],
        }),
      }),
    );
    // 網址的值一律是字串（web-core/router/search.ts）
    expect(router.state.location.search).toEqual({
      status: 'all',
      type: 'fileFolder.access',
      queue: 'true',
    });
    expect(
      within(await screen.findByTestId('approval-detail-page')).getByTestId('approval-detail-back'),
    ).toBeInTheDocument();
  });

  it('沒有 queue（從通知或網址進來）：審核後不找下一筆，留在原頁', async () => {
    const { router } = renderRoute(routes, '/approval/a1', REVIEWER);
    fireEvent.click(
      await screen.findByTestId('approval-approve-button', undefined, { timeout: 5000 }),
    );

    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    expect(fetchList).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/approval/a1');
  });
});
