import { RootRoute } from '@b2b-system/web-core/router';
import { renderRoute } from '@b2b-system/web-core/testing';
import { createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { Routes } from '../..';
import approvalZhTW from '../../locales/zh_TW.json';
import { registerApprovalPagePermissions } from '../../permission';
import { PendingApprovalsSection } from '../PendingApprovalsSection';

const { fetchCounts, fetchList } = vi.hoisted(() => ({
  fetchCounts: vi.fn(),
  fetchList: vi.fn(),
}));
vi.mock('@/apis/approval/get-approval-counts/fetcher', () => ({
  fetchApprovalCountsQuery: fetchCounts,
}));
vi.mock('@/apis/approval/get-approval-list/fetcher', () => ({
  fetchApprovalListQuery: fetchList,
}));

const ITEM = {
  id: 'a1',
  type: 'fileFolder.access',
  status: 'pending',
  requesterName: 'Alice',
  createdAt: '2026-10-01T00:00:00.000Z',
  currentStep: {
    ordinal: 0,
    name: '部門主管',
    approvals: 0,
    required: 1,
    shortage: null,
    activatedAt: '2026-10-01T00:00:00.000Z',
    pendingReviewers: ['Me'],
    pendingCount: 1,
  },
};

const HomeRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/',
  component: PendingApprovalsSection,
});
const routes = [HomeRoute, Routes.MyApprovalRoute, Routes.ApprovalListRoute];

beforeAll(() => initTestI18n(approvalZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalPagePermissions();
  fetchList.mockReset().mockResolvedValue({
    items: [ITEM],
    pagination: { offset: 0, limit: 3, total: 1 },
  });
});

describe('首頁的待辦（docs/architecture/backend/20-approval.md §11.1）', () => {
  it('有待我審核：顯示筆數與最舊的幾筆（依申請時間升冪查詢）', async () => {
    fetchCounts.mockResolvedValue({ assigned: 2, pending: null });
    renderRoute(routes, '/', []);
    expect(
      await screen.findByTestId('home-pending-approvals-assigned', undefined, { timeout: 5000 }),
    ).toHaveTextContent('有 2 筆申請等你審核');
    expect(await screen.findByTestId('home-pending-approval')).toHaveTextContent('資料夾存取申請');
    expect(fetchList).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          scope: 'assigned',
          limit: 3,
          sort: [{ sort: 'createdAt', order: 'asc' }],
        }),
      }),
    );
    // 沒有審核權：不顯示全部的待審
    expect(screen.queryByTestId('home-pending-approvals-pending')).toBeNull();
  });

  it('審核者：另外顯示全部的待審數', async () => {
    fetchCounts.mockResolvedValue({ assigned: 0, pending: 4 });
    renderRoute(routes, '/', ['approval:read', 'approval:review'] as PermissionKey[]);
    expect(
      await screen.findByTestId('home-pending-approvals-pending', undefined, { timeout: 5000 }),
    ).toHaveTextContent('共有 4 筆待審核的申請');
    expect(fetchList).not.toHaveBeenCalled();
  });

  it('什麼都沒有 → 不渲染', async () => {
    fetchCounts.mockResolvedValue({ assigned: 0, pending: 0 });
    renderRoute(routes, '/', ['approval:read', 'approval:review'] as PermissionKey[]);
    await waitFor(() => expect(fetchCounts).toHaveBeenCalled());
    expect(screen.queryByTestId('home-pending-approvals')).toBeNull();
  });
});
