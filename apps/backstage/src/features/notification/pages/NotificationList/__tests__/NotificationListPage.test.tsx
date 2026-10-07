import { sessionStore } from '@b2b-system/web-core/auth';
import { resetBatchOperations, setActiveBatchQueue } from '@b2b-system/web-core/batch';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { createFakeBatchQueue, renderRoute } from '@b2b-system/web-core/testing';
import { renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import type { Notification } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { registerNotificationPagePermissions, Routes } from '../../..';
import { registerNotificationBatchOperations } from '../../../batch';
import zhTW from '../../../locales/zh_TW.json';

const { fetchList, fetchCount, markRead, markAllRead, deleteOne } = vi.hoisted(() => ({
  fetchList: vi.fn(),
  fetchCount: vi.fn(),
  markRead: vi.fn(),
  deleteOne: vi.fn(),
  markAllRead: vi.fn(),
}));
vi.mock('@/apis/notification/get-notification-list/fetcher', () => ({
  fetchNotificationListQuery: fetchList,
}));
vi.mock('@/apis/notification/get-notification-unread-count/fetcher', () => ({
  fetchNotificationUnreadCountQuery: fetchCount,
}));
vi.mock('@/apis/notification/mark-notification-read/fetcher', () => ({
  fetchMarkNotificationReadMutation: markRead,
}));
vi.mock('@/apis/notification/delete-notification/fetcher', () => ({
  fetchDeleteNotificationMutation: deleteOne,
}));
vi.mock('@/apis/notification/mark-all-notifications-read/fetcher', () => ({
  fetchMarkAllNotificationsReadMutation: markAllRead,
}));

const ROLES_CHANGED: Notification = {
  id: 'n-roles',
  type: 'user.rolesChanged',
  params: { added: ['內容編輯'], removed: ['稽核人員'] },
  link: { route: 'account.profile', params: {} },
  actor: { id: 'u1', name: 'Admin' },
  readAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
};

const APPROVED: Notification = {
  id: 'n-approved',
  type: 'approval.result',
  params: { approvalType: 'fileFolder.access', subject: '財務報表', status: 'approved' },
  link: null,
  actor: { id: 'u1', name: 'Admin' },
  readAt: '2026-10-02T00:00:00.000Z',
  createdAt: '2026-10-01T12:00:00.000Z',
};

const routes = [Routes.NotificationListRoute];

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.presumeSession();
  resetPagePermissionRegistry();
  registerNotificationPagePermissions();
  fetchCount.mockResolvedValue({ count: 1 });
  fetchList.mockResolvedValue({ items: [ROLES_CHANGED], nextCursor: null });
  markAllRead.mockResolvedValue({ updated: 1 });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  sessionStore.clear();
  vi.restoreAllMocks();
});

describe('通知列表頁的頁面權限（只需要登入，docs/architecture/backend/15-notification.md §12.2 D9）', () => {
  it('沒有任何權限 → 進得去（不受權限管制），看得到自己的通知', async () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: true });
    const { result } = renderHook(() => usePageAccess('/notification'));
    expect(result.current).toMatchObject({ gated: false, canAccess: true });

    renderRoute(routes, '/notification', []);
    expect(await screen.findByText('你的角色已變更')).toBeInTheDocument();
  });

  it('有其他權限 → 同樣進得去，內容不因權限而不同', async () => {
    renderRoute(routes, '/notification', ['user:read', 'role:read'] as PermissionKey[]);
    expect(await screen.findByText('你的角色已變更')).toBeInTheDocument();
    expect(screen.getByText('新增：內容編輯')).toBeInTheDocument();
    expect(screen.getByText('移除：稽核人員')).toBeInTheDocument();
  });

  it('權限未水合 → 不等權限、不閃 403，照常列出（不受權限管制的頁面）', async () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    const { result } = renderHook(() => usePageAccess('/notification'));
    expect(result.current).toMatchObject({ hydrated: false, gated: false, canAccess: true });

    renderRoute(routes, '/notification', 'unhydrated');
    expect(await screen.findByText('你的角色已變更')).toBeInTheDocument();
  });
});

describe('通知列表頁（docs/architecture/frontend/15-notification.md §4）', () => {
  it('切到「未讀」：網址帶 filter=unread，以未讀篩選重新查詢', async () => {
    const { router } = renderRoute(routes, '/notification', []);
    await screen.findByText('你的角色已變更');
    await userEvent.click(screen.getByRole('tab', { name: '未讀' }));

    await waitFor(() => expect(router.state.location.search).toEqual({ filter: 'unread' }));
    await waitFor(() =>
      expect(fetchList.mock.calls.some(([request]) => request.params.filter === 'unread')).toBe(
        true,
      ),
    );
  });

  it('網址帶 filter=unread 直接進來 → 只查未讀；沒有時顯示「沒有未讀的通知」', async () => {
    fetchList.mockResolvedValue({ items: [], nextCursor: null });
    renderRoute(routes, '/notification?filter=unread', []);
    expect(await screen.findByTestId('notification-empty')).toHaveTextContent('沒有未讀的通知');
    expect(fetchList.mock.calls[0]![0].params.filter).toBe('unread');
  });

  it('全部已讀：呼叫 API 並提示', async () => {
    renderRoute(routes, '/notification', []);
    await screen.findByText('你的角色已變更');
    await waitFor(() =>
      expect(screen.getByTestId('notification-page-mark-all-read')).toBeEnabled(),
    );
    await userEvent.click(screen.getByTestId('notification-page-mark-all-read'));
    await waitFor(() => expect(markAllRead).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('已將 1 則通知標為已讀')).toBeInTheDocument();
  });

  it('查詢失敗 → 錯誤訊息與重試，而不是空狀態', async () => {
    fetchList.mockRejectedValue(new Error('boom'));
    renderRoute(routes, '/notification', []);
    expect(await screen.findByTestId('notification-error')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-empty')).toBeNull();
  });
});

describe('通知列表頁：詳細內容、刪除與批次操作（docs/architecture/frontend/15-notification.md §4）', () => {
  let queue: ReturnType<typeof createFakeBatchQueue>;

  beforeEach(async () => {
    fetchList.mockResolvedValue({ items: [ROLES_CHANGED, APPROVED], nextCursor: null });
    markRead.mockImplementation(async ({ params }: { params: { notificationId: string } }) => ({
      ...ROLES_CHANGED,
      id: params.notificationId,
      readAt: new Date().toISOString(),
    }));
    registerNotificationBatchOperations();
    queue = createFakeBatchQueue();
    const tab = queue.openTab('this-tab');
    await tab.start();
    setActiveBatchQueue(tab);
  });

  afterEach(() => {
    setActiveBatchQueue(undefined);
    queue.dispose();
    resetBatchOperations();
  });

  it('點一則（沒有連結的也可以）→ 打開詳細內容並標為已讀', async () => {
    fetchList.mockResolvedValue({
      items: [{ ...APPROVED, readAt: null }],
      nextCursor: null,
    });
    renderRoute(routes, '/notification', []);
    await userEvent.click(await screen.findByTestId('notification-item-open'));

    const dialog = await screen.findByTestId('notification-detail-dialog');
    expect(dialog).toHaveTextContent('你的資料夾存取申請已核准');
    expect(dialog).toHaveTextContent('財務報表');
    expect(within(dialog).queryByTestId('notification-detail-link')).toBeNull();
    await waitFor(() =>
      expect(markRead.mock.calls[0]![0].params).toEqual({ notificationId: 'n-approved' }),
    );
  });

  it('全選已載入的通知 → 批次標為已讀只送出未讀的那幾則，已讀的略過', async () => {
    renderRoute(routes, '/notification', []);
    await screen.findByText('你的角色已變更');
    expect(screen.getAllByTestId('notification-item-select')).toHaveLength(2);

    await userEvent.click(screen.getByRole('checkbox', { name: '全選這裡的 2 則' }));
    expect(screen.getByTestId('batch-action-bar-count')).toHaveAttribute('data-value', '2');

    await userEvent.click(
      screen
        .getAllByTestId('batch-action')
        .find((button) => button.getAttribute('data-value') === 'markRead')!,
    );
    const dialog = await screen.findByTestId('batch-confirm-dialog');
    expect(dialog).toHaveTextContent('將 1 則通知標為已讀？');
    await userEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));

    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    expect(markRead.mock.calls[0]![0].params).toEqual({ notificationId: 'n-roles' });
  });

  it('列尾的「刪除」：刪掉那一則並提示；詳細內容裡的「刪除」也是', async () => {
    deleteOne.mockResolvedValue(undefined);
    renderRoute(routes, '/notification', []);
    await screen.findByText('你的角色已變更');
    await userEvent.click(
      screen
        .getAllByTestId('notification-item-delete')
        .find((button) => button.getAttribute('data-value') === 'n-approved')!,
    );
    await waitFor(() =>
      expect(deleteOne.mock.calls[0]![0].params).toEqual({ notificationId: 'n-approved' }),
    );
    expect(await screen.findByText('已刪除通知')).toBeInTheDocument();

    await userEvent.click(screen.getAllByTestId('notification-item-open')[0]!);
    const dialog = await screen.findByTestId('notification-detail-dialog');
    await userEvent.click(within(dialog).getByTestId('notification-detail-delete'));
    await waitFor(() =>
      expect(deleteOne.mock.calls[1]![0].params).toEqual({ notificationId: 'n-roles' }),
    );
  });

  it('批次刪除：已讀與未讀都送出', async () => {
    deleteOne.mockResolvedValue(undefined);
    renderRoute(routes, '/notification', []);
    await screen.findByText('你的角色已變更');
    await userEvent.click(screen.getByRole('checkbox', { name: '全選這裡的 2 則' }));
    await userEvent.click(
      screen
        .getAllByTestId('batch-action')
        .find((button) => button.getAttribute('data-value') === 'delete')!,
    );
    const dialog = await screen.findByTestId('batch-confirm-dialog');
    expect(dialog).toHaveTextContent('刪除 2 則通知？');
    await userEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(deleteOne).toHaveBeenCalledTimes(2));
  });

  it('只勾已讀的 →「標為已讀」停用、「刪除」可以按', async () => {
    renderRoute(routes, '/notification', []);
    await screen.findByText('你的資料夾存取申請已核准');
    await userEvent.click(screen.getByRole('checkbox', { name: '選取：你的資料夾存取申請已核准' }));
    // 有 tooltip 說明原因的停用是 aria-disabled（仍可聚焦）
    const [markReadAction, deleteAction] = screen.getAllByTestId('batch-action');
    expect(markReadAction).toHaveAttribute('aria-disabled', 'true');
    expect(deleteAction).not.toHaveAttribute('aria-disabled');
  });
});
