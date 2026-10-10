import { AllProviders } from '@b2b-system/web-core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationPreference } from '@/shared/api-sdk';

import { NotificationPreferenceSection } from '../NotificationPreferenceSection';

const { listPreferences, updatePreferences } = vi.hoisted(() => ({
  listPreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));
vi.mock('@/apis/notification/get-notification-preference-list/query', () => ({
  NOTIFICATION_PREFERENCE_LIST_QUERY_KEY: 'NOTIFICATION_PREFERENCE_LIST_QUERY_KEY',
  getNotificationPreferenceListQueryOptions: () => ({
    queryKey: ['NOTIFICATION_PREFERENCE_LIST_QUERY_KEY'],
    queryFn: listPreferences,
  }),
}));
vi.mock('@/apis/notification/update-notification-preferences/mutation', () => ({
  getUpdateNotificationPreferencesMutationOptions: () => ({ mutationFn: updatePreferences }),
}));

const ITEMS: NotificationPreference[] = [
  {
    type: 'approval.result',
    category: 'approval',
    channels: [
      { channel: 'inApp', enabled: true, isOverridden: false, lock: null },
      { channel: 'email', enabled: false, isOverridden: true, lock: null },
    ],
  },
  {
    type: 'approval.pending',
    category: 'approval',
    channels: [{ channel: 'inApp', enabled: true, isOverridden: false, lock: 'tenantRequired' }],
  },
  {
    type: 'user.rolesChanged',
    category: 'user',
    channels: [{ channel: 'inApp', enabled: false, isOverridden: false, lock: 'tenantDisabled' }],
  },
];

function channelOf(type: string, channel: string): HTMLElement {
  const row = screen
    .getAllByTestId('notification-preference-row')
    .find((item) => item.getAttribute('data-value') === type);
  const element = row
    ? within(row)
        .getAllByTestId('notification-preference-channel')
        .find((item) => item.getAttribute('data-value') === channel)
    : undefined;
  if (!element) throw new Error(`找不到 ${type} 的管道 ${channel}`);
  return element;
}

beforeEach(() => {
  listPreferences.mockReset().mockResolvedValue({ items: ITEMS });
  updatePreferences.mockReset().mockResolvedValue({ items: ITEMS });
});

describe('偏好頁的通知分頁（docs/architecture/frontend/15-notification.md §10）', () => {
  it('切換即儲存：只送出那一個事件 ＋ 管道', async () => {
    render(<NotificationPreferenceSection />, { wrapper: AllProviders });
    await screen.findAllByTestId('notification-preference-row');
    fireEvent.click(
      within(channelOf('approval.result', 'inApp')).getByTestId('notification-preference-switch'),
    );
    await waitFor(() => expect(updatePreferences).toHaveBeenCalled());
    expect(updatePreferences.mock.calls[0]![0]).toMatchObject({
      params: { changes: [{ type: 'approval.result', channel: 'inApp', enabled: false }] },
    });
  });

  it('租戶要求或關掉的管道：開關停用並顯示原因；可以調整的沒有原因', async () => {
    render(<NotificationPreferenceSection />, { wrapper: AllProviders });
    await screen.findAllByTestId('notification-preference-row');
    const required = channelOf('approval.pending', 'inApp');
    expect(within(required).getByTestId('notification-preference-switch')).toHaveAttribute(
      'data-disabled',
    );
    expect(within(required).getByTestId('notification-preference-lock')).toHaveAttribute(
      'data-value',
      'tenantRequired',
    );
    expect(
      within(channelOf('user.rolesChanged', 'inApp')).getByTestId('notification-preference-lock'),
    ).toHaveAttribute('data-value', 'tenantDisabled');
    expect(
      within(channelOf('approval.result', 'email')).queryByTestId('notification-preference-lock'),
    ).toBeNull();
  });

  it('儲存中只停用那一個開關，其他照常可切換', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    updatePreferences.mockImplementationOnce(() => new Promise((done) => (resolve = done)));
    render(<NotificationPreferenceSection />, { wrapper: AllProviders });
    await screen.findAllByTestId('notification-preference-row');
    const inApp = within(channelOf('approval.result', 'inApp')).getByTestId(
      'notification-preference-switch',
    );
    const email = within(channelOf('approval.result', 'email')).getByTestId(
      'notification-preference-switch',
    );
    fireEvent.click(inApp);
    await waitFor(() => expect(inApp).toHaveAttribute('data-disabled'));
    expect(email).not.toHaveAttribute('data-disabled');

    resolve({ items: ITEMS });
    await waitFor(() => expect(inApp).not.toHaveAttribute('data-disabled'));
  });

  it('查詢失敗 → 顯示錯誤與重試，不是空的設定（docs/architecture/frontend/07-ui-system.md §6.1）', async () => {
    listPreferences.mockRejectedValueOnce(new Error('boom'));
    render(<NotificationPreferenceSection />, { wrapper: AllProviders });
    const error = await screen.findByTestId('notification-preference-error');
    expect(screen.queryByTestId('notification-preference-row')).toBeNull();
    fireEvent.click(within(error).getByTestId('query-error-retry'));
    expect(await screen.findAllByTestId('notification-preference-row')).toHaveLength(3);
  });
});
