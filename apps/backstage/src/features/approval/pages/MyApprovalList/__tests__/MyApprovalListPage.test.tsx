import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature/store';
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
  type: 'fileFolder.access',
  status: 'pending',
  payload: {},
  requesterId: 'u1',
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
    name: '資料夾管理者',
    approvals: 0,
    required: 1,
    shortage: null,
    activatedAt: '2026-09-25T01:00:00.000Z',
    pendingReviewers: ['王小明', '李小華', '陳大文'],
    pendingCount: 5,
  },
  stepCount: 2,
  resubmittedFrom: null,
  createdAt: '2026-09-25T01:00:00.000Z',
  updatedAt: '2026-09-25T01:00:00.000Z',
};

const routes = [Routes.MyApprovalRoute];

function setChainEnabled(enabled: boolean): void {
  featureStore.setState({
    resolved: true,
    statuses: new Map([['approvalChain', enabled ? 'ready' : 'disabled']]),
  });
}

beforeAll(() => initTestI18n(approvalZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerApprovalPagePermissions();
  fetchList.mockReset();
  fetchList.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
  fetchDetail.mockReset().mockReturnValue(new Promise(() => {}));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => setChainEnabled(false));

describe('我的審批（docs/architecture/backend/20-approval.md §9.10）', () => {
  it('多階段已啟用：預設「待我審核」，以 scope=assigned 查詢；不需要任何權限', async () => {
    setChainEnabled(true);
    renderRoute(routes, '/my-approvals', []);
    expect(await screen.findByTestId('my-approval-page')).toBeInTheDocument();
    expect(screen.getByText('待我審核')).toBeInTheDocument();
    expect(screen.getByText('我的申請')).toBeInTheDocument();
    // 待辦：最早送出的在前（與首頁的待辦、詳情的「下一筆」同一個順序）
    expect(fetchList).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          scope: 'assigned',
          sort: [{ sort: 'createdAt', order: 'asc' }],
        }),
      }),
    );
  });

  it('多階段未啟用：只有「我的申請」', async () => {
    setChainEnabled(false);
    renderRoute(routes, '/my-approvals', []);
    expect(await screen.findByTestId('my-approval-page')).toBeInTheDocument();
    expect(screen.queryByText('待我審核')).not.toBeInTheDocument();
    expect(fetchList).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ scope: 'mine' }) }),
    );
  });
});

describe('我的審批的列表', () => {
  it('列出申請；空的時候依分頁顯示不同的說明', async () => {
    setChainEnabled(true);
    renderRoute(routes, '/my-approvals', []);
    expect(
      await screen.findByText('目前沒有等你審核的申請', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('切到「我的申請」：網址帶 tab，以 scope=mine 查詢並回到第一頁', async () => {
    setChainEnabled(true);
    const { router } = renderRoute(routes, '/my-approvals', []);
    fireEvent.click(await screen.findByRole('tab', { name: '我的申請' }, { timeout: 5000 }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ tab: 'mine' }));
    await waitFor(() =>
      expect(fetchList).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ scope: 'mine', offset: 0 }) }),
      ),
    );
    expect(await screen.findByText('你還沒有送出任何申請')).toBeInTheDocument();
  });

  it('網址帶的分頁在多階段未啟用時不存在 → 退回「我的申請」', async () => {
    setChainEnabled(false);
    renderRoute(routes, '/my-approvals?tab=assigned', []);
    await screen.findByTestId('my-approval-page', undefined, { timeout: 5000 });
    expect(fetchList).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ scope: 'mine' }) }),
    );
  });

  it('顯示類型、申請人與狀態；雙擊打開詳情', async () => {
    setChainEnabled(false);
    fetchList.mockResolvedValue({
      items: [APPROVAL],
      pagination: { offset: 0, limit: 20, total: 1 },
    });
    const { router } = renderRoute(
      [Routes.MyApprovalRoute, Routes.MyApprovalDetailRoute],
      '/my-approvals',
      [],
    );
    const link = await screen.findByTestId('my-approval-detail-link', undefined, { timeout: 5000 });
    expect(link).toHaveTextContent('資料夾存取申請');
    expect(link).toHaveAttribute('data-value', 'Alice');
    expect(screen.getByTestId('my-approval-status')).toHaveTextContent('待審核');
    // 目前的關卡在等誰（docs/architecture/backend/20-approval.md §11.2）
    expect(screen.getByTestId('approval-progress-waiting')).toHaveTextContent(
      '等待 王小明、李小華、陳大文 等 5 人',
    );

    fireEvent.doubleClick(link.closest('tr')!);
    await waitFor(() => expect(router.state.location.pathname).toBe('/my-approvals/a1'));
  });

  it('換頁：以新的 offset 查詢', async () => {
    setChainEnabled(false);
    fetchList.mockResolvedValue({
      items: [APPROVAL],
      pagination: { offset: 0, limit: 20, total: 45 },
    });
    renderRoute(routes, '/my-approvals', []);
    // 資料回來前分頁列的總數是 0、下一頁停用
    await screen.findByTestId('my-approval-detail-link', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('pagination-next'));
    await waitFor(() =>
      expect(fetchList).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ offset: 20 }) }),
      ),
    );
  });
});
