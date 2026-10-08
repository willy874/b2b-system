import { sessionStore } from '@b2b-system/web-core/auth';
import { AppError } from '@b2b-system/web-core/errors';
import { resetRouteLinkRegistry } from '@b2b-system/web-core/route-link';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPagePermissionRegistry } from '@/core/permission';
import { registerTenantPagePermissions } from '@/features/tenant';
import { registerTenantRouteLinks } from '@/features/tenant/routeLinks';
import { TenantDetailRoute } from '@/features/tenant/routes/pages';
import { initTestI18n } from '@/test/i18n';

import { registerNotificationPagePermissions, Routes } from '..';
import { NotificationBell } from '../components/NotificationBell';
import notificationZhTW from '../locales/zh_TW.json';

const { fetchCount, fetchList, markAll, markRead, deleteOne } = vi.hoisted(() => ({
  fetchCount: vi.fn(),
  fetchList: vi.fn(),
  markAll: vi.fn(),
  markRead: vi.fn(),
  deleteOne: vi.fn(),
}));
vi.mock('@/apis/platform-notification/get-notification-unread-count/fetcher', () => ({
  fetchNotificationUnreadCountQuery: fetchCount,
}));
vi.mock('@/apis/platform-notification/get-notification-list/fetcher', () => ({
  fetchNotificationListQuery: fetchList,
}));
vi.mock('@/apis/platform-notification/mark-all-notifications-read/fetcher', () => ({
  fetchMarkAllNotificationsReadMutation: markAll,
}));
vi.mock('@/apis/platform-notification/mark-notification-read/fetcher', () => ({
  fetchMarkNotificationReadMutation: markRead,
}));
vi.mock('@/apis/platform-notification/delete-notification/fetcher', () => ({
  fetchDeleteNotificationMutation: deleteOne,
}));

beforeAll(() => initTestI18n(notificationZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  resetRouteLinkRegistry();
  registerNotificationPagePermissions();
  vi.spyOn(sessionStore, 'hasSession').mockReturnValue(true);
  fetchCount.mockReset().mockResolvedValue({ count: 3 });
  fetchList.mockReset().mockResolvedValue({
    items: [
      {
        id: 'n1',
        type: 'tenant.provisioned',
        params: { code: 'acme', name: 'Acme' },
        link: { route: 'tenant.detail', params: { id: 't1' } },
        readAt: null,
        createdAt: new Date().toISOString(),
      },
    ],
    pagination: { offset: 0, limit: 10, total: 1 },
  });
  markAll.mockReset().mockResolvedValue({ updated: 3 });
  markRead.mockReset().mockResolvedValue({});
  deleteOne.mockReset().mockResolvedValue(undefined);
});

function renderBell() {
  Routes.NotificationListRoute.update({ component: () => <NotificationBell /> });
  return renderRoute([Routes.NotificationListRoute], '/notification', []);
}

describe('NotificationBell（頂列的通知）', () => {
  it('徽章是未讀數；名稱帶未讀數', async () => {
    renderBell();
    expect(await screen.findByTestId('notification-unread-count')).toHaveAttribute(
      'data-value',
      '3',
    );
    expect(screen.getByRole('button', { name: '通知中心（3 則未讀）' })).toBeInTheDocument();
  });

  it('打開才抓列表；route id 沒登記時沒有快速連結', async () => {
    renderBell();
    await screen.findByTestId('notification-unread-count');
    expect(fetchList).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('notification-bell'));
    const item = await screen.findByTestId('notification-item');
    expect(item).toHaveTextContent('租戶「Acme」（acme）佈建完成，可以使用了。');
    expect(item).toHaveAttribute('data-state', 'unread');
    expect(screen.queryByTestId('notification-item-link')).toBeNull();
  });

  it('點一則：關閉 Popover、打開詳細內容並標為已讀', async () => {
    renderBell();
    await screen.findByTestId('notification-unread-count');
    fireEvent.click(screen.getByTestId('notification-bell'));
    fireEvent.click(await screen.findByTestId('notification-item-open'));
    const dialog = await screen.findByTestId('notification-detail-dialog');
    expect(dialog).toHaveTextContent('租戶「Acme」（acme）佈建完成，可以使用了。');
    await waitFor(() =>
      expect(markRead.mock.calls[0]![0].params).toEqual({ notificationId: 'n1' }),
    );
    await waitFor(() => expect(screen.queryByTestId('notification-panel')).toBeNull());
  });

  it('全部標為已讀', async () => {
    renderBell();
    await screen.findByTestId('notification-unread-count');
    fireEvent.click(screen.getByTestId('notification-bell'));
    fireEvent.click(await screen.findByTestId('notification-mark-all-read'));
    await waitFor(() => expect(markAll).toHaveBeenCalled());
  });

  it('沒有連結的未讀通知從列尾按鈕標為已讀；標題旁顯示未讀數', async () => {
    renderBell();
    await screen.findByTestId('notification-unread-count');
    fireEvent.click(screen.getByTestId('notification-bell'));
    const panel = await screen.findByTestId('notification-panel');
    expect(panel).toHaveTextContent('3 則未讀');
    fireEvent.click(await screen.findByRole('button', { name: '標為已讀' }));
    await waitFor(() =>
      expect(markRead.mock.calls[0]![0].params).toEqual({ notificationId: 'n1' }),
    );
  });

  it('未讀超過 99 → 徽章顯示 99+', async () => {
    fetchCount.mockResolvedValue({ count: 150 });
    renderBell();
    const badge = await screen.findByTestId('notification-unread-count');
    expect(badge).toHaveTextContent('99+');
    expect(badge).toHaveAttribute('data-value', '150');
  });

  it('沒有未讀 → 沒有徽章，名稱不帶數量，「全部已讀」停用', async () => {
    fetchCount.mockResolvedValue({ count: 0 });
    renderBell();
    expect(await screen.findByRole('button', { name: '通知中心' })).toBeInTheDocument();
    expect(screen.queryByTestId('notification-unread-count')).toBeNull();
    fireEvent.click(screen.getByTestId('notification-bell'));
    expect(await screen.findByTestId('notification-mark-all-read')).toBeDisabled();
  });

  it('沒有通知 → 顯示空狀態', async () => {
    fetchList.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 10, total: 0 } });
    renderBell();
    fireEvent.click(await screen.findByTestId('notification-bell'));
    expect(await screen.findByTestId('notification-empty')).toHaveTextContent('還沒有通知');
  });

  it('列表取不到 → 顯示錯誤，重試後再抓一次', async () => {
    fetchList.mockRejectedValueOnce(new AppError('INTERNAL_ERROR', 500));
    renderBell();
    fireEvent.click(await screen.findByTestId('notification-bell'));
    expect(await screen.findByTestId('notification-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('query-error-retry'));
    expect(await screen.findByTestId('notification-item')).toBeInTheDocument();
    expect(fetchList).toHaveBeenCalledTimes(2);
  });

  it('全部已讀被拒絕（403）→ 顯示錯誤提示', async () => {
    markAll.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    renderBell();
    await screen.findByTestId('notification-unread-count');
    fireEvent.click(screen.getByTestId('notification-bell'));
    fireEvent.click(await screen.findByTestId('notification-mark-all-read'));
    expect(await screen.findByTestId('toast')).toBeInTheDocument();
  });

  it('「查看全部」關閉 Popover', async () => {
    renderBell();
    fireEvent.click(await screen.findByTestId('notification-bell'));
    fireEvent.click(await screen.findByTestId('notification-view-all'));
    await waitFor(() => expect(screen.queryByTestId('notification-panel')).toBeNull());
  });

  it('詳細內容裡刪除 → 送出刪除', async () => {
    renderBell();
    fireEvent.click(await screen.findByTestId('notification-bell'));
    fireEvent.click(await screen.findByTestId('notification-item-open'));
    fireEvent.click(await screen.findByTestId('notification-detail-delete'));
    await waitFor(() =>
      expect(deleteOne.mock.calls[0]![0].params).toEqual({ notificationId: 'n1' }),
    );
  });

  it('有權限看連結的目標 → 快速連結：標為已讀、關閉 Popover 並前往', async () => {
    registerTenantPagePermissions();
    registerTenantRouteLinks();
    Routes.NotificationListRoute.update({ component: () => <NotificationBell /> });
    const { router } = renderRoute(
      [Routes.NotificationListRoute, TenantDetailRoute],
      '/notification',
      ['tenant:read'],
    );
    fireEvent.click(await screen.findByTestId('notification-bell'));
    fireEvent.click(await screen.findByTestId('notification-item-link'));
    await waitFor(() =>
      expect(markRead.mock.calls[0]![0].params).toEqual({ notificationId: 'n1' }),
    );
    await waitFor(() => expect(screen.queryByTestId('notification-panel')).toBeNull());
    await waitFor(() => expect(router.state.location.pathname).toBe('/tenant/t1'));
  });
});
