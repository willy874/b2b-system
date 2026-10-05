import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import type { NotificationVM } from '../../adapter';
import zhTW from '../../locales/zh_TW.json';
import { useMarkAllNotificationsReadMutation } from '../useNotificationMutations';
import { useOpenNotification } from '../useOpenNotification';

const { markRead, markAllRead, invalidateResources } = vi.hoisted(() => ({
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/notification/mark-notification-read/fetcher', () => ({
  fetchMarkNotificationReadMutation: markRead,
}));
vi.mock('@/apis/notification/mark-all-notifications-read/fetcher', () => ({
  fetchMarkAllNotificationsReadMutation: markAllRead,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources,
}));

const vm = (isRead: boolean): NotificationVM => ({
  id: 'n1',
  isRead,
  message: { key: 'notification.message.unknown', args: {} },
  details: [],
  actorName: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  link: undefined,
});

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
  markRead.mockResolvedValue({ id: 'n1' });
  markAllRead.mockResolvedValue({ updated: 2 });
});

describe('useOpenNotification（點一則通知）', () => {
  it('未讀的標為已讀，並宣告 notification update 讓列表與未讀數重抓', async () => {
    const { result } = renderHook(() => useOpenNotification(), { wrapper: AllProviders });
    act(() => result.current(vm(false)));
    await waitFor(() =>
      expect(invalidateResources).toHaveBeenCalledWith([
        { resource: 'notification', kind: 'update', id: 'n1' },
      ]),
    );
    expect(markRead.mock.calls[0]![0].params).toEqual({ notificationId: 'n1' });
  });

  it('已讀的不再呼叫 API', () => {
    const { result } = renderHook(() => useOpenNotification(), { wrapper: AllProviders });
    act(() => result.current(vm(true)));
    expect(markRead).not.toHaveBeenCalled();
  });
});

describe('useMarkAllNotificationsReadMutation', () => {
  it('全部已讀後宣告 notification update（不帶 id）', async () => {
    const { result } = renderHook(() => useMarkAllNotificationsReadMutation(), {
      wrapper: AllProviders,
    });
    act(() => result.current.mutate({ params: undefined }));
    await waitFor(() =>
      expect(invalidateResources).toHaveBeenCalledWith([
        { resource: 'notification', kind: 'update' },
      ]),
    );
  });
});
