import { createRoute } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/core/auth';
import { resetLocaleRegistry } from '@/core/locales';
import { registerRouteLink, resetRouteLinkRegistry } from '@/core/route-link';
import { RootRoute } from '@/core/router';
import type { Notification } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { Routes } from '../..';
import zhTW from '../../locales/zh_TW.json';
import { NotificationBell } from '../NotificationBell';

const { fetchList, fetchCount, markRead, markAllRead, invalidateResources } = vi.hoisted(() => ({
  fetchList: vi.fn(),
  fetchCount: vi.fn(),
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  invalidateResources: vi.fn(),
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
vi.mock('@/apis/notification/mark-all-notifications-read/fetcher', () => ({
  fetchMarkAllNotificationsReadMutation: markAllRead,
}));
// 依賴圖作用在全域的 queryClient，不是測試的 QueryClient：這裡只斷言宣告了什麼變更
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources,
}));

/** 頂列：鈴鐺掛在每一頁上（這裡用首頁代表）。 */
const HomeRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/',
  component: NotificationBell,
});
const ApprovalDetailRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/approval/$approvalId',
  component: () => <p data-testid="approval-page">approval</p>,
});
const routes = [HomeRoute, ApprovalDetailRoute, Routes.NotificationListRoute];

const PENDING: Notification = {
  id: 'n-pending',
  type: 'approval.pending',
  params: { approvalType: 'user.register', requesterName: 'carol@example.com', subject: 'Carol' },
  link: { route: 'approval.detail', params: { approvalId: 'a1' } },
  actor: null,
  readAt: null,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};
const UNKNOWN: Notification = {
  id: 'n-unknown',
  type: 'webhook.disabled',
  params: {},
  link: { route: 'webhook.detail', params: { webhookId: 'w1' } },
  actor: { id: 'u1', name: 'Admin' },
  readAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-09-30T00:00:00.000Z',
};

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.presumeSession();
  // 鈴鐺自己載入語系包：測試已經把 zhTW 放進 i18n，不必再登記 scope
  resetLocaleRegistry();
  resetRouteLinkRegistry();
  registerRouteLink('approval.detail', {
    route: ApprovalDetailRoute,
    params: { approvalId: 'approvalId' },
  });
  fetchCount.mockResolvedValue({ count: 2 });
  fetchList.mockResolvedValue({ items: [PENDING, UNKNOWN], nextCursor: null });
  markRead.mockResolvedValue({ ...PENDING, readAt: new Date().toISOString() });
  markAllRead.mockResolvedValue({ updated: 2 });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  sessionStore.clear();
  vi.restoreAllMocks();
});

async function openPanel() {
  await userEvent.click(await screen.findByTestId('notification-bell'));
  return screen.findByTestId('notification-panel');
}

describe('NotificationBell（頂列的通知工具，docs/architecture/backend/15-notification.md §12.2 D12）', () => {
  it('徽章顯示未讀數，按鈕的可存取名稱帶數量；打開前不抓列表', async () => {
    renderRoute(routes, '/', []);
    const badge = await screen.findByTestId('notification-unread-count');
    expect(badge).toHaveTextContent('2');
    expect(screen.getByTestId('notification-bell')).toHaveAccessibleName('通知：2 則未讀');
    expect(fetchList).not.toHaveBeenCalled();
  });

  it('沒有未讀時不顯示徽章、「全部已讀」停用', async () => {
    fetchCount.mockResolvedValue({ count: 0 });
    renderRoute(routes, '/', []);
    const panel = await openPanel();
    expect(screen.queryByTestId('notification-unread-count')).toBeNull();
    expect(within(panel).getByTestId('notification-mark-all-read')).toBeDisabled();
  });

  it('超過 99 則顯示 99+', async () => {
    fetchCount.mockResolvedValue({ count: 150 });
    renderRoute(routes, '/', []);
    expect(await screen.findByTestId('notification-unread-count')).toHaveTextContent('99+');
  });

  it('打開後列出句子、觸發者；不認得的類型顯示通用文字且不可點', async () => {
    renderRoute(routes, '/', []);
    const panel = await openPanel();
    const items = await within(panel).findAllByTestId('notification-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('carol@example.com 送出了帳號註冊申請，等待審核');
    expect(items[0]).toHaveTextContent('Carol');
    expect(items[0]).toHaveTextContent('系統 · 5 分鐘前');
    expect(items[0]).toHaveAttribute('data-state', 'unread');
    expect(items[0]?.tagName).toBe('A');
    expect(items[1]).toHaveTextContent('你有一則新通知');
    expect(items[1]).toHaveTextContent('Admin');
    expect(items[1]?.tagName).not.toBe('A');
  });

  it('點有連結的一則：標為已讀、換到該頁並關閉 Popover', async () => {
    const { router } = renderRoute(routes, '/', []);
    const panel = await openPanel();
    const [item] = await within(panel).findAllByTestId('notification-item');
    await userEvent.click(item!);

    await waitFor(() => expect(router.state.location.pathname).toBe('/approval/a1'));
    expect(markRead.mock.calls[0]![0].params).toEqual({ notificationId: 'n-pending' });
    await waitFor(() => expect(screen.queryByTestId('notification-panel')).toBeNull());
  });

  it('全部已讀：呼叫 API，宣告 notification update 讓未讀數與列表重抓', async () => {
    renderRoute(routes, '/', []);
    const panel = await openPanel();
    await within(panel).findAllByTestId('notification-item');
    await userEvent.click(within(panel).getByTestId('notification-mark-all-read'));

    await waitFor(() => expect(markAllRead).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateResources).toHaveBeenCalledWith([
        { resource: 'notification', kind: 'update' },
      ]),
    );
  });

  it('「查看全部」連到列表頁', async () => {
    const { router } = renderRoute(routes, '/', []);
    const panel = await openPanel();
    await userEvent.click(within(panel).getByTestId('notification-view-all'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/notification'));
  });

  it('沒有通知時顯示空狀態', async () => {
    fetchList.mockResolvedValue({ items: [], nextCursor: null });
    renderRoute(routes, '/', []);
    const panel = await openPanel();
    expect(await within(panel).findByTestId('notification-empty')).toHaveTextContent(
      '目前沒有通知',
    );
  });
});
