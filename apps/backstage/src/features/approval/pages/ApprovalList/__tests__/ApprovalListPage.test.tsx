import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerApprovalPagePermissions, Routes } from '../../..';
import approvalZhTW from '../../../locales/zh_TW.json';

const { fetchList, fetchDetail } = vi.hoisted(() => ({ fetchList: vi.fn(), fetchDetail: vi.fn() }));
vi.mock('@/apis/approval/get-approval-list/fetcher', () => ({ fetchApprovalListQuery: fetchList }));
vi.mock('@/apis/approval/get-approval-detail/fetcher', () => ({
  fetchApprovalDetailQuery: fetchDetail,
}));

const APPROVAL = {
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
};
const REVIEWED = {
  ...APPROVAL,
  id: 'a2',
  status: 'approved',
  requesterName: 'bob@example.com',
  reviewerName: '管理員',
  reviewedAt: '2026-09-26T01:00:00.000Z',
};

const REVIEWER = ['approval:read', 'approval:review'] as PermissionKey[];
const routes = [Routes.ApprovalListRoute];

beforeAll(() => initTestI18n(approvalZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalPagePermissions();
  fetchList.mockReset();
  // 詳情在這些測試裡不重要：維持載入中
  fetchDetail.mockReset().mockReturnValue(new Promise(() => {}));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('ApprovalListPage（docs/architecture/frontend/07-ui-system.md §6.1）', () => {
  it('查詢失敗 → 顯示錯誤與重試，不落到「沒有資料」（審核者不會以為沒有待審的申請）', async () => {
    fetchList.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, '/approval', REVIEWER);

    expect(
      await screen.findByTestId('rich-table-error', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText('目前沒有待審核的申請')).toBeNull();

    fetchList.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
    fireEvent.click(screen.getByTestId('query-error-retry'));
    expect(await screen.findByText('目前沒有待審核的申請')).toBeInTheDocument();
    // 空的列表說明申請從哪裡來
    expect(screen.getByTestId('approval-sources-hint')).toBeInTheDocument();
  });
});

describe('ApprovalListPage 的匯出（docs/architecture/backend/22-data-transfer.md §12.5）', () => {
  afterEach(() => {
    featureStore.setState({ resolved: true, statuses: new Map() });
  });

  it('有 approval:export → 匯出可以選請求或審核紀錄；沒有就不顯示', async () => {
    fetchList.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
    featureStore.setState({ resolved: true, statuses: new Map([['dataTransfer', 'ready']]) });
    renderRoute(routes, '/approval', [...REVIEWER, 'approval:export'] as PermissionKey[]);
    fireEvent.click(
      await screen.findByTestId('approval-export-button', undefined, { timeout: 5000 }),
    );
    expect(await screen.findByText('審核紀錄（每一關的決定）')).toBeInTheDocument();
  });

  it('沒有 approval:export → 不顯示匯出', async () => {
    fetchList.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
    featureStore.setState({ resolved: true, statuses: new Map([['dataTransfer', 'ready']]) });
    renderRoute(routes, '/approval', REVIEWER);
    await screen.findByText('目前沒有待審核的申請', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('approval-export-button')).toBeNull();
  });
});

const listOf = (items: unknown[], total = items.length) => ({
  items,
  pagination: { offset: 0, limit: 20, total },
});

/** 某一列（以申請人定位）。 */
async function rowOf(requester: string) {
  const links = await screen.findAllByTestId('approval-detail-link', undefined, {
    timeout: 5000,
  });
  const link = links.find((element) => element.getAttribute('data-value') === requester);
  if (!link) throw new Error(`找不到 ${requester} 的申請`);
  return link.closest('tr')!;
}

describe('ApprovalListPage 的列表（ApprovalTable）', () => {
  beforeEach(() => {
    fetchList.mockResolvedValue(listOf([APPROVAL, REVIEWED]));
  });

  it('列出類型、申請人、狀態與審核者；未審核的審核者顯示「-」', async () => {
    renderRoute(routes, '/approval', REVIEWER);
    const pending = await rowOf('alice@example.com');
    expect(within(pending).getByTestId('approval-detail-link')).toHaveTextContent('註冊申請');
    expect(within(pending).getByTestId('approval-status')).toHaveTextContent('待審核');
    expect(pending).toHaveTextContent('-');

    const reviewed = await rowOf('bob@example.com');
    expect(within(reviewed).getByTestId('approval-status')).toHaveAttribute(
      'data-value',
      'approved',
    );
    expect(reviewed).toHaveTextContent('管理員');
  });

  it('有 approval:review → 有操作欄（待審核的列可以快速核准）', async () => {
    renderRoute(routes, '/approval', REVIEWER);
    const pending = await rowOf('alice@example.com');
    expect(screen.getByRole('columnheader', { name: '操作' })).toBeInTheDocument();
    expect(within(pending).getByTestId('approval-quick-approve')).toBeInTheDocument();
  });

  it('沒有 approval:review → 整欄不出現', async () => {
    renderRoute(routes, '/approval', ['approval:read'] as PermissionKey[]);
    await rowOf('alice@example.com');
    expect(screen.queryByRole('columnheader', { name: '操作' })).toBeNull();
    expect(screen.queryByTestId('approval-quick-approve')).toBeNull();
  });

  it('權限未水合 → 不閃現操作欄', async () => {
    renderRoute(routes, '/approval', 'unhydrated');
    await waitFor(() => expect(screen.queryByTestId('approval-quick-approve')).toBeNull());
    expect(screen.queryByRole('columnheader', { name: '操作' })).toBeNull();
  });

  it('點申請時間排序：寫進網址並以它查詢', async () => {
    const { router } = renderRoute(routes, '/approval', REVIEWER);
    await rowOf('alice@example.com');
    fireEvent.click(screen.getByRole('button', { name: '申請時間' }));
    await waitFor(() =>
      expect(fetchList).toHaveBeenLastCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ sort: [{ sort: 'createdAt', order: 'asc' }] }),
        }),
      ),
    );
    expect(JSON.stringify(router.state.location.search)).toContain('createdAt');
  });

  it('雙擊一列 → 打開那筆申請的詳情', async () => {
    const { router } = renderRoute(
      [Routes.ApprovalListRoute, Routes.ApprovalDetailRoute],
      '/approval',
      REVIEWER,
    );
    fireEvent.doubleClick(await rowOf('bob@example.com'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/approval/a2'));
    // 從待審清單（預設）點進去：決定後前往下一筆
    expect(router.state.location.search).toMatchObject({ queue: 'true' });
  });

  it('預設只看待審；切到「全部」不帶狀態查詢，詳情不帶 queue', async () => {
    const { router } = renderRoute(
      [Routes.ApprovalListRoute, Routes.ApprovalDetailRoute],
      '/approval',
      REVIEWER,
    );
    await rowOf('alice@example.com');
    expect(fetchList).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ status: ['pending'] }) }),
    );

    fireEvent.click(within(screen.getByTestId('approval-status-tabs')).getByText('全部狀態'));
    await waitFor(() =>
      expect(fetchList).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ status: undefined }) }),
      ),
    );
    expect(router.state.location.search).toMatchObject({ status: 'all' });
    fireEvent.doubleClick(await rowOf('bob@example.com'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/approval/a2'));
    expect(router.state.location.search).not.toHaveProperty('queue');
  });

  it('換頁：以新的 offset 查詢', async () => {
    fetchList.mockResolvedValue(listOf([APPROVAL], 45));
    renderRoute(routes, '/approval', REVIEWER);
    await rowOf('alice@example.com');
    fireEvent.click(screen.getByTestId('pagination-next'));
    await waitFor(() =>
      expect(fetchList).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ offset: 20 }) }),
      ),
    );
  });
});
