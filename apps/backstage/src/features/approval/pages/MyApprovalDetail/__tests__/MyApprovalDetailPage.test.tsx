import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature/store';
import { resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import type { ApprovalRequestDetail, ApprovalStep } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { registerApprovalPagePermissions, Routes } from '../../..';
import approvalZhTW from '../../../locales/zh_TW.json';

const { fetchDetail, fetchList, decide } = vi.hoisted(() => ({
  fetchDetail: vi.fn(),
  fetchList: vi.fn(),
  decide: vi.fn(),
}));
vi.mock('@/apis/approval/get-approval-detail/fetcher', () => ({
  fetchApprovalDetailQuery: fetchDetail,
}));
vi.mock('@/apis/approval/get-approval-list/fetcher', () => ({
  fetchApprovalListQuery: fetchList,
}));
vi.mock('@/apis/auth/get-profile/fetcher', () => ({
  fetchProfileQuery: vi.fn(async () => ({ user: { id: 'u-bob' }, roles: [], permissions: [] })),
}));
vi.mock('@/apis/approval/decide-approval-step/fetcher', () => ({
  fetchApprovalStepDecideMutation: decide,
}));

const STEP: ApprovalStep = {
  ordinal: 1,
  key: 'finance',
  name: '財務',
  assignee: { kind: 'group', id: 'g1', label: '財務群組' },
  requiredMode: 'count',
  required: 1,
  status: 'active',
  shortage: null,
  closeReason: null,
  conditions: [],
  activatedAt: '2026-10-01T01:00:00.000Z',
  closedAt: null,
  candidates: [{ userId: 'u-bob', name: 'Bob' }],
  decisions: [],
};

/** 多階段的請求，目前這一關輪到登入者（Bob）：沒有任何權限也能做決定（viewer 由後端決定）。 */
const DTO: ApprovalRequestDetail = {
  id: 'a1',
  type: 'fileFolder.access',
  status: 'pending',
  payload: { folderId: 'f1', folderName: '設計稿', level: 'viewer' },
  requesterId: 'u-alice',
  requesterName: 'Alice',
  reason: null,
  reviewerId: null,
  reviewerName: null,
  reviewComment: null,
  reviewedAt: null,
  resultResourceId: null,
  flowVersion: 1,
  currentStep: {
    ordinal: 1,
    name: '財務',
    approvals: 0,
    required: 1,
    shortage: null,
    activatedAt: '2026-10-01T01:00:00.000Z',
    pendingReviewers: ['Bob'],
    pendingCount: 1,
  },
  stepCount: 1,
  resubmittedFrom: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  steps: [STEP],
  viewer: { canDecide: true, canOverride: false, canReviewSingle: false, canWithdraw: false },
  resubmittedTo: null,
};

const page = (ids: string[]) => ({
  items: ids.map((id) => ({ ...DTO, id })),
  pagination: { offset: 0, limit: 20, total: ids.length },
});

// 列表只留一個標記：這裡只測詳情頁與返回的去向
Routes.MyApprovalRoute.update({ component: () => <div data-testid="my-approval-list-stub" /> });
const routes = [Routes.MyApprovalRoute, Routes.MyApprovalDetailRoute];

function setChainEnabled(enabled: boolean): void {
  featureStore.setState({
    resolved: true,
    statuses: new Map([['approvalChain', enabled ? 'ready' : 'disabled']]),
  });
}

async function findTitle(text: string) {
  await waitFor(() => expect(screen.getByTestId('approval-detail-title')).toHaveTextContent(text), {
    timeout: 5000,
  });
}

beforeAll(() => initTestI18n(approvalZhTW));

beforeEach(() => {
  vi.clearAllMocks();
  resetPagePermissionRegistry();
  registerApprovalPagePermissions();
  setChainEnabled(true);
  fetchDetail.mockImplementation(async ({ params }) => ({ ...DTO, id: params.approvalId }));
  fetchList.mockResolvedValue(page([]));
  decide.mockResolvedValue({ ...DTO, status: 'approved' });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  setChainEnabled(false);
  vi.restoreAllMocks();
});

describe('「我的審批」的詳情（個人頁，docs/architecture/backend/20-approval.md §9.10）', () => {
  it('不需要任何權限：一般登入者就能進，渲染整個詳情與輪到他的決定', async () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: true });
    expect(renderHook(() => usePageAccess('/my-approvals/a1')).result.current).toMatchObject({
      canAccess: true,
    });

    renderRoute(routes, '/my-approvals/a1', []);
    await findTitle('資料夾存取申請');
    expect(screen.getByText('設計稿')).toBeInTheDocument();
    expect(screen.getByTestId('approval-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('approval-step-approve-button')).toBeEnabled();
    expect(screen.getByTestId('approval-detail-back')).toHaveTextContent('回到我的審批');
  });

  it('「回到我的審批」回到 /my-approvals，帶著原本的分頁、不帶 queue', async () => {
    const { router } = renderRoute(routes, '/my-approvals/a1?tab=mine&offset=20&queue=true', []);
    await findTitle('資料夾存取申請');
    fireEvent.click(screen.getByTestId('approval-detail-back'));

    expect(await screen.findByTestId('my-approval-list-stub')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/my-approvals');
    // 網址的值一律是字串（web-core/router/search.ts）
    expect(router.state.location.search).toEqual({ tab: 'mine', offset: '20' });
  });

  it('從「待我審核」進來（queue、沒有 tab）：以 scope=assigned、最早送出的在前找下一筆', async () => {
    fetchList.mockResolvedValue(page(['a2', 'a3']));
    const { router } = renderRoute(routes, '/my-approvals/a1?queue=true', []);
    await findTitle('資料夾存取申請');
    fireEvent.click(screen.getByTestId('approval-step-approve-button'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/my-approvals/a2'));
    expect(decide.mock.calls[0]![0]).toMatchObject({
      params: { approvalId: 'a1', ordinal: 1, body: { decision: 'approve' } },
    });
    expect(fetchList).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          scope: 'assigned',
          sort: [{ sort: 'createdAt', order: 'asc' }],
        }),
      }),
    );
    // 下一筆仍在「待我審核」的脈絡裡（網址的值一律是字串）
    expect(router.state.location.search).toEqual({ queue: 'true' });
  });

  it('帶著 tab=mine 進來：下一筆從「我的申請」的清單（後端預設排序）找', async () => {
    fetchList.mockResolvedValue(page(['a2']));
    const { router } = renderRoute(routes, '/my-approvals/a1?tab=mine&queue=true', []);
    await findTitle('資料夾存取申請');
    fireEvent.click(screen.getByTestId('approval-step-approve-button'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/my-approvals/a2'));
    expect(fetchList).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ scope: 'mine', sort: [] }) }),
    );
    expect(router.state.location.search).toEqual({ tab: 'mine', queue: 'true' });
  });

  it('清單裡沒有下一筆：回到「我的審批」', async () => {
    const { router } = renderRoute(routes, '/my-approvals/a1?queue=true', []);
    await findTitle('資料夾存取申請');
    fireEvent.click(screen.getByTestId('approval-step-approve-button'));

    expect(await screen.findByTestId('my-approval-list-stub')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/my-approvals');
  });

  it('沒有 queue（從通知或網址進來）：決定後不找下一筆，留在原頁', async () => {
    const { router } = renderRoute(routes, '/my-approvals/a1', []);
    await findTitle('資料夾存取申請');
    fireEvent.click(screen.getByTestId('approval-step-approve-button'));

    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(fetchList).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/my-approvals/a1');
  });
});
