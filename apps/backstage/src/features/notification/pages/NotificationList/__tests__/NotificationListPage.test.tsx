import { renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/core/auth';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import { usePermissionStore } from '@/core/store';
import type { Notification } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { registerNotificationPagePermissions, Routes } from '../../..';
import zhTW from '../../../locales/zh_TW.json';

const { fetchList, fetchCount, markAllRead } = vi.hoisted(() => ({
  fetchList: vi.fn(),
  fetchCount: vi.fn(),
  markAllRead: vi.fn(),
}));
vi.mock('@/apis/notification/get-notification-list/fetcher', () => ({
  fetchNotificationListQuery: fetchList,
}));
vi.mock('@/apis/notification/get-notification-unread-count/fetcher', () => ({
  fetchNotificationUnreadCountQuery: fetchCount,
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
