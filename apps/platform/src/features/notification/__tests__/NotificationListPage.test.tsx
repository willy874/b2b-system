import { sessionStore } from '@b2b-system/web-core/auth';
import { resetBatchOperations, setActiveBatchQueue } from '@b2b-system/web-core/batch';
import { resetRouteLinkRegistry } from '@b2b-system/web-core/route-link';
import { createFakeBatchQueue, renderRoute } from '@b2b-system/web-core/testing';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerNotificationPagePermissions, Routes } from '..';
import { registerNotificationBatchOperations } from '../batch';
import notificationZhTW from '../locales/zh_TW.json';

const { fetchCount, fetchList, markRead, deleteOne } = vi.hoisted(() => ({
  fetchCount: vi.fn(),
  fetchList: vi.fn(),
  markRead: vi.fn(),
  deleteOne: vi.fn(),
}));
vi.mock('@/apis/platform-notification/get-notification-unread-count/fetcher', () => ({
  fetchNotificationUnreadCountQuery: fetchCount,
}));
vi.mock('@/apis/platform-notification/get-notification-list/fetcher', () => ({
  fetchNotificationListQuery: fetchList,
}));
vi.mock('@/apis/platform-notification/mark-notification-read/fetcher', () => ({
  fetchMarkNotificationReadMutation: markRead,
}));
vi.mock('@/apis/platform-notification/delete-notification/fetcher', () => ({
  fetchDeleteNotificationMutation: deleteOne,
}));

const ITEMS = [
  {
    id: 'n1',
    type: 'tenant.provisioned',
    params: { code: 'acme', name: 'Acme' },
    link: null,
    readAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'n2',
    type: 'tenant.provisioned',
    params: { code: 'beta', name: 'Beta' },
    link: null,
    readAt: '2026-10-02T00:00:00.000Z',
    createdAt: '2026-09-30T00:00:00.000Z',
  },
];

let queue: ReturnType<typeof createFakeBatchQueue>;

beforeAll(() => initTestI18n(notificationZhTW));

beforeEach(async () => {
  resetPagePermissionRegistry();
  resetRouteLinkRegistry();
  registerNotificationPagePermissions();
  registerNotificationBatchOperations();
  vi.spyOn(sessionStore, 'hasSession').mockReturnValue(true);
  fetchCount.mockReset().mockResolvedValue({ count: 1 });
  fetchList.mockReset().mockResolvedValue({
    items: ITEMS,
    pagination: { offset: 0, limit: 20, total: 2 },
  });
  markRead.mockReset().mockResolvedValue({ success: true });
  deleteOne.mockReset().mockResolvedValue(undefined);
  queue = createFakeBatchQueue();
  const tab = queue.openTab('this-tab');
  await tab.start();
  setActiveBatchQueue(tab);
});

afterEach(() => {
  setActiveBatchQueue(undefined);
  queue.dispose();
  resetBatchOperations();
  vi.restoreAllMocks();
});

describe('通知列表頁：勾選與批次操作（同 backstage，docs/architecture/frontend/15-notification.md §4）', () => {
  it('全選這一頁 → 批次標為已讀只送出未讀的', async () => {
    renderRoute([Routes.NotificationListRoute], '/notification', []);
    await screen.findByText('租戶「Acme」（acme）佈建完成，可以使用了。');
    await userEvent.click(screen.getByRole('checkbox', { name: '全選這裡的 2 則' }));
    await userEvent.click(
      screen
        .getAllByTestId('batch-action')
        .find((button) => button.getAttribute('data-value') === 'markRead')!,
    );
    const dialog = await screen.findByTestId('batch-confirm-dialog');
    await userEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(markRead).toHaveBeenCalledTimes(1));
    expect(markRead.mock.calls[0]![0].params).toEqual({ notificationId: 'n1' });
  });

  it('勾一則 → 批次刪除；列尾的「刪除」也可以刪', async () => {
    renderRoute([Routes.NotificationListRoute], '/notification', []);
    await screen.findByText('租戶「Beta」（beta）佈建完成，可以使用了。');
    await userEvent.click(
      screen.getByRole('checkbox', { name: '選取：租戶「Beta」（beta）佈建完成，可以使用了。' }),
    );
    await userEvent.click(
      screen
        .getAllByTestId('batch-action')
        .find((button) => button.getAttribute('data-value') === 'delete')!,
    );
    const dialog = await screen.findByTestId('batch-confirm-dialog');
    await userEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(deleteOne).toHaveBeenCalledTimes(1));
    expect(deleteOne.mock.calls[0]![0].params).toEqual({ notificationId: 'n2' });

    await userEvent.click(screen.getAllByTestId('notification-item-delete')[0]!);
    await waitFor(() => expect(deleteOne).toHaveBeenCalledTimes(2));
    expect(deleteOne.mock.calls[1]![0].params).toEqual({ notificationId: 'n1' });
  });
});
