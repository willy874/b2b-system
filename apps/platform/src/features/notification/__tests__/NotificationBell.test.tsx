import { sessionStore } from '@b2b-system/web-core/auth';
import { resetRouteLinkRegistry } from '@b2b-system/web-core/route-link';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerNotificationPagePermissions, Routes } from '..';
import { NotificationBell } from '../components/NotificationBell';
import notificationZhTW from '../locales/zh_TW.json';

const { fetchCount, fetchList, markAll, markRead } = vi.hoisted(() => ({
  fetchCount: vi.fn(),
  fetchList: vi.fn(),
  markAll: vi.fn(),
  markRead: vi.fn(),
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
});
