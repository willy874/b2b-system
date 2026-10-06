import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import type { NotificationEvent } from '@/shared/api-sdk';

import { registerNotificationPagePermissions, Routes } from '../../..';

const { listEvents, updateEvents } = vi.hoisted(() => ({
  listEvents: vi.fn(),
  updateEvents: vi.fn(),
}));
vi.mock('@/apis/notification/get-notification-event-list/query', () => ({
  NOTIFICATION_EVENT_LIST_QUERY_KEY: 'NOTIFICATION_EVENT_LIST_QUERY_KEY',
  getNotificationEventListQueryOptions: () => ({
    queryKey: ['NOTIFICATION_EVENT_LIST_QUERY_KEY'],
    queryFn: listEvents,
  }),
}));
vi.mock('@/apis/notification/update-notification-events/mutation', () => ({
  getUpdateNotificationEventsMutationOptions: () => ({ mutationFn: updateEvents }),
}));

const EVENTS: NotificationEvent[] = [
  {
    type: 'approval.result',
    category: 'approval',
    mandatory: false,
    channels: [
      {
        channel: 'inApp',
        enabled: true,
        defaultEnabled: true,
        isOverridden: false,
        allowUserOverride: true,
        updatedAt: null,
      },
      {
        channel: 'email',
        enabled: false,
        defaultEnabled: true,
        isOverridden: true,
        allowUserOverride: true,
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  },
  {
    type: 'security.locked',
    category: 'security',
    mandatory: true,
    channels: [
      {
        channel: 'inApp',
        enabled: true,
        defaultEnabled: true,
        isOverridden: false,
        allowUserOverride: true,
        updatedAt: null,
      },
    ],
  },
];

function renderPage(permissions: PermissionKey[] | 'unhydrated') {
  usePermissionStore.setState(
    permissions === 'unhydrated'
      ? { permissions: new Set(), hydrated: false }
      : { permissions: new Set(permissions), hydrated: true },
  );
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.NotificationEventListRoute]),
    history: createMemoryHistory({ initialEntries: ['/notification/events'] }),
    parseSearch,
    stringifySearch,
  });
  const result = render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
  return { ...result, router };
}

function rowOf(type: string): HTMLElement {
  const element = screen
    .getAllByTestId('notification-event-row')
    .find((item) => item.getAttribute('data-value') === type);
  if (!element) throw new Error(`找不到事件 ${type}`);
  return element;
}

function channelOf(type: string, channel: string): HTMLElement {
  const element = within(rowOf(type))
    .getAllByTestId('notification-event-channel')
    .find((item) => item.getAttribute('data-value') === channel);
  if (!element) throw new Error(`找不到 ${type} 的管道 ${channel}`);
  return element;
}

beforeEach(() => {
  resetPagePermissionRegistry();
  registerNotificationPagePermissions();
  listEvents.mockReset().mockResolvedValue({ items: EVENTS });
  updateEvents.mockReset().mockResolvedValue({ items: EVENTS });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('事件管理頁（docs/architecture/frontend/15-notification.md §9）', () => {
  it('有 system:update → 切換開關後出現儲存，只送出改過的事件與管道', async () => {
    renderPage(['system:read', 'system:update'] as PermissionKey[]);
    await screen.findAllByTestId('notification-event-row');
    expect(screen.queryByTestId('notification-event-save')).toBeNull();

    fireEvent.click(
      within(channelOf('approval.result', 'inApp')).getByTestId('notification-event-switch'),
    );
    fireEvent.click(await screen.findByTestId('notification-event-save'));

    await waitFor(() => expect(updateEvents).toHaveBeenCalled());
    expect(updateEvents.mock.calls[0]![0]).toMatchObject({
      params: { changes: [{ type: 'approval.result', channel: 'inApp', enabled: false }] },
    });
  });

  it('取消「允許個人關閉」→ 送出 allowUserOverride: false；mandatory 沒有這個選項', async () => {
    renderPage(['system:read', 'system:update'] as PermissionKey[]);
    await screen.findAllByTestId('notification-event-row');
    expect(
      within(rowOf('security.locked')).queryByTestId('notification-event-allow-override'),
    ).toBeNull();
    fireEvent.click(
      within(channelOf('approval.result', 'inApp')).getByTestId(
        'notification-event-allow-override',
      ),
    );
    fireEvent.click(await screen.findByTestId('notification-event-save'));
    await waitFor(() => expect(updateEvents).toHaveBeenCalled());
    expect(updateEvents.mock.calls[0]![0]).toMatchObject({
      params: {
        changes: [{ type: 'approval.result', channel: 'inApp', allowUserOverride: false }],
      },
    });
  });

  it('恢復預設 → 送出 enabled: null', async () => {
    renderPage(['system:read', 'system:update'] as PermissionKey[]);
    const reset = await screen.findByTestId('notification-event-reset');
    expect(reset).toHaveAttribute('data-value', 'email');
    fireEvent.click(reset);
    fireEvent.click(await screen.findByTestId('notification-event-save'));
    await waitFor(() => expect(updateEvents).toHaveBeenCalled());
    expect(updateEvents.mock.calls[0]![0]).toMatchObject({
      params: { changes: [{ type: 'approval.result', channel: 'email', enabled: null }] },
    });
  });

  it('mandatory 的事件 → 開關停用並標示不能關閉；不認得的事件以 type 顯示', async () => {
    renderPage(['system:read', 'system:update'] as PermissionKey[]);
    await screen.findAllByTestId('notification-event-row');
    const row = rowOf('security.locked');
    expect(within(row).getByTestId('notification-event-mandatory')).toBeVisible();
    expect(within(row).getByText('security.locked')).toBeVisible();
    expect(within(row).getByTestId('notification-event-switch')).toHaveAttribute('data-disabled');
  });

  it('只有 system:read → 看得到目前的設定與「已修改」，但不能切換、沒有恢復預設', async () => {
    renderPage(['system:read'] as PermissionKey[]);
    await screen.findAllByTestId('notification-event-row');
    expect(
      within(channelOf('approval.result', 'email')).getByTestId('notification-event-overridden'),
    ).toBeVisible();
    expect(screen.queryByTestId('notification-event-reset')).toBeNull();
    expect(
      within(channelOf('approval.result', 'inApp')).getByTestId('notification-event-switch'),
    ).toHaveAttribute('data-disabled');
  });

  it('權限未水合 → 不閃現編輯操作', async () => {
    renderPage('unhydrated');
    expect(await screen.findByTestId('notification-event-page')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-event-reset')).toBeNull();
    expect(screen.queryByTestId('notification-event-save')).toBeNull();
  });

  describe('未儲存提醒', () => {
    it('切換開關還沒儲存就換頁：先確認；選「繼續編輯」後留在原處', async () => {
      const { router } = renderPage(['system:read', 'system:update'] as PermissionKey[]);
      await screen.findAllByTestId('notification-event-row');
      fireEvent.click(
        within(channelOf('approval.result', 'inApp')).getByTestId('notification-event-switch'),
      );
      await screen.findByTestId('notification-event-save');
      router.history.push('/user');

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
      expect(router.state.location.pathname).toBe('/notification/events');
      expect(screen.getByTestId('notification-event-save')).toBeInTheDocument();
    });

    it('沒有改動時換頁：不確認', async () => {
      const { router } = renderPage(['system:read', 'system:update'] as PermissionKey[]);
      await screen.findAllByTestId('notification-event-row');
      router.history.push('/user');

      await waitFor(() => expect(router.state.location.pathname).toBe('/user'));
      expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
    });
  });
});
