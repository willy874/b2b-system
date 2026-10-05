import { usePermissionStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry, usePageAccess } from '@/core/permission';
import type { NotificationOverviewItem } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { registerNotificationPagePermissions, Routes } from '../../..';
import zhTW from '../../../locales/zh_TW.json';

const { fetchOverview, fetchUsers } = vi.hoisted(() => ({
  fetchOverview: vi.fn(),
  fetchUsers: vi.fn(),
}));
vi.mock('@/apis/notification/get-notification-overview/fetcher', () => ({
  fetchNotificationOverviewQuery: fetchOverview,
}));
vi.mock('@/apis/user/get-user-list/fetcher', () => ({
  fetchUserListQuery: fetchUsers,
}));

const item = (
  id: string,
  values: Partial<NotificationOverviewItem> = {},
): NotificationOverviewItem => ({
  id,
  type: 'user.rolesChanged',
  params: { added: ['內容編輯'], removed: [] },
  link: null,
  actor: { id: 'u-admin', name: 'Admin' },
  readAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  recipient: { id: 'u-alice', name: 'Alice' },
  ...values,
});

const READER = ['notification:read', 'user:read'] as PermissionKey[];
const routes = [Routes.NotificationOverviewRoute];

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
  resetPagePermissionRegistry();
  registerNotificationPagePermissions();
  fetchOverview.mockResolvedValue({
    items: [
      item('n1'),
      item('n2', {
        type: 'future.event',
        params: {},
        actor: null,
        readAt: '2026-10-01T01:00:00.000Z',
        recipient: { id: 'u-bob', name: 'Bob' },
      }),
    ],
    nextCursor: null,
  });
  fetchUsers.mockResolvedValue({ items: [], pagination: { offset: 0, limit: 20, total: 0 } });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('通知總覽的頁面權限（docs/architecture/backend/19-announcement.md §9.2 D2）', () => {
  it('有 notification:read → 進得去，列出所有人的通知', async () => {
    usePermissionStore.setState({ permissions: new Set(READER), hydrated: true });
    const { result } = renderHook(() => usePageAccess('/notification/all'));
    expect(result.current).toMatchObject({ gated: true, canAccess: true });

    renderRoute(routes, '/notification/all', READER);
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('沒有 notification:read → 不能進（只看自己的 /notification 不受影響）', () => {
    usePermissionStore.setState({
      permissions: new Set(['user:read', 'system:read'] as PermissionKey[]),
      hydrated: true,
    });
    expect(renderHook(() => usePageAccess('/notification/all')).result.current).toMatchObject({
      gated: true,
      canAccess: false,
    });
    expect(renderHook(() => usePageAccess('/notification')).result.current).toMatchObject({
      canAccess: true,
    });
  });

  it('權限未水合 → 還不能判斷（不閃現內容，也不閃 403）', () => {
    usePermissionStore.setState({ permissions: new Set(), hydrated: false });
    expect(renderHook(() => usePageAccess('/notification/all')).result.current).toMatchObject({
      hydrated: false,
      gated: true,
    });
  });
});

describe('通知總覽頁（docs/architecture/backend/19-announcement.md §9.2 D1）', () => {
  it('每一列：收件人、事件名稱、收件人看到的句子、觸發者、已讀狀態；不認得的事件顯示 type', async () => {
    renderRoute(routes, '/notification/all', READER);
    const table = await screen.findByTestId('notification-overview-table');
    await within(table).findByText('Alice');
    expect(within(table).getByText('角色變更')).toBeInTheDocument();
    expect(within(table).getByText('你的角色已變更')).toBeInTheDocument();
    expect(within(table).getByText('新增：內容編輯')).toBeInTheDocument();
    expect(within(table).getByText('Admin')).toBeInTheDocument();
    expect(within(table).getByText('未讀')).toBeInTheDocument();
    expect(within(table).getByText('future.event')).toBeInTheDocument();
    expect(within(table).getByText('系統')).toBeInTheDocument();
  });

  it('網址上的篩選帶進查詢；日期換成當地日界線', async () => {
    renderRoute(
      routes,
      '/notification/all?type=approval.pending&recipientId=00000000-0000-4000-8000-000000000001&unread=true&from=2026-09-01&to=2026-09-30',
      READER,
    );
    await waitFor(() => expect(fetchOverview).toHaveBeenCalled());
    const params = fetchOverview.mock.calls[0]![0].params;
    expect(params).toMatchObject({
      type: 'approval.pending',
      recipientId: '00000000-0000-4000-8000-000000000001',
      unread: true,
      limit: 50,
    });
    expect(params.from).toMatch(/^2026-0(8-31|9-01)T/);
    expect(params.to).toMatch(/^2026-(09-30|10-01)T/);
  });

  it('有下一頁 → 「載入更多」以游標接續', async () => {
    fetchOverview
      .mockResolvedValueOnce({ items: [item('n1')], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({
        items: [item('n3', { recipient: { id: 'u-carol', name: 'Carol' } })],
        nextCursor: null,
      });
    renderRoute(routes, '/notification/all', READER);
    await userEvent.click(await screen.findByTestId('notification-overview-load-more'));
    expect(await screen.findByText('Carol')).toBeInTheDocument();
    expect(fetchOverview.mock.calls[1]![0].params).toMatchObject({ cursor: 'cursor-1' });
    await waitFor(() => expect(screen.queryByTestId('notification-overview-load-more')).toBeNull());
  });
});
