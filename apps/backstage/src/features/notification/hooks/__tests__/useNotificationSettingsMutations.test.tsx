import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { useUpdateNotificationEventsMutation } from '../useUpdateNotificationEventsMutation';
import { useUpdateNotificationPreferencesMutation } from '../useUpdateNotificationPreferencesMutation';

const api = vi.hoisted(() => ({
  updateEvents: vi.fn(),
  updatePreferences: vi.fn(),
  invalidateResources: vi.fn(),
}));
vi.mock('@/apis/notification/update-notification-events/fetcher', () => ({
  fetchUpdateNotificationEventsMutation: api.updateEvents,
}));
vi.mock('@/apis/notification/update-notification-preferences/fetcher', () => ({
  fetchUpdateNotificationPreferencesMutation: api.updatePreferences,
}));
vi.mock('@/apis/resources', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invalidateResources: api.invalidateResources,
}));

const FORBIDDEN_MESSAGE = '你沒有執行這個操作的權限。';

/** 同一個類型改了兩個管道：失效時只算一次。 */
const changes = [
  { type: 'user.rolesChanged', channel: 'inApp', enabled: false },
  { type: 'user.rolesChanged', channel: 'email', enabled: true },
  { type: 'approval.requested', channel: 'inApp', enabled: true },
];

function render<T>(hook: () => T) {
  return renderHook(hook, { wrapper: AllProviders }).result;
}

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useUpdateNotificationEventsMutation（租戶的事件開關）', () => {
  it('儲存成功 → 每個改到的類型宣告一筆 notificationPolicy update（去重），並提示', async () => {
    api.updateEvents.mockResolvedValue({ items: [] });
    const result = render(() => useUpdateNotificationEventsMutation());
    const variables = { params: { changes } as never };
    act(() => result.current.mutate(variables));

    expect(await screen.findByText('已儲存事件通知設定')).toBeInTheDocument();
    expect(api.updateEvents.mock.calls[0]![0]).toEqual(variables);
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'notificationPolicy', kind: 'update', id: 'user.rolesChanged' },
      { resource: 'notificationPolicy', kind: 'update', id: 'approval.requested' },
    ]);
  });

  it('失敗 → 錯誤交給呼叫端：不失效、不彈 toast', async () => {
    api.updateEvents.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useUpdateNotificationEventsMutation());
    act(() => result.current.mutate({ params: { changes } as never }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText(FORBIDDEN_MESSAGE)).not.toBeInTheDocument();
  });
});

describe('useUpdateNotificationPreferencesMutation（個人的通知開關）', () => {
  it('儲存成功 → 每個改到的類型宣告一筆 notificationPreference update（去重），並提示', async () => {
    api.updatePreferences.mockResolvedValue({ items: [] });
    const result = render(() => useUpdateNotificationPreferencesMutation());
    const variables = { params: { changes } as never };
    act(() => result.current.mutate(variables));

    expect(await screen.findByText('已儲存通知設定')).toBeInTheDocument();
    expect(api.updatePreferences.mock.calls[0]![0]).toEqual(variables);
    expect(api.invalidateResources).toHaveBeenCalledWith([
      { resource: 'notificationPreference', kind: 'update', id: 'user.rolesChanged' },
      { resource: 'notificationPreference', kind: 'update', id: 'approval.requested' },
    ]);
  });

  it('失敗 → 錯誤交給呼叫端：不失效、不彈 toast', async () => {
    api.updatePreferences.mockRejectedValue(new AppError('AUTHZ_FORBIDDEN', 403));
    const result = render(() => useUpdateNotificationPreferencesMutation());
    act(() => result.current.mutate({ params: { changes } as never }));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(api.invalidateResources).not.toHaveBeenCalled();
    expect(screen.queryByText(FORBIDDEN_MESSAGE)).not.toBeInTheDocument();
  });
});
