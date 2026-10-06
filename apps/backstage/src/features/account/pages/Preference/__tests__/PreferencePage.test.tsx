import { AppError } from '@b2b-system/web-core/errors';
import { useTimezoneStore } from '@b2b-system/web-core/store';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerAccountPagePermissions, Routes } from '../../..';
import accountZhTW from '../../../locales/zh_TW.json';

const { updateProfile } = vi.hoisted(() => ({ updateProfile: vi.fn() }));
vi.mock('@/apis/auth/update-profile/fetcher', () => ({
  fetchUpdateProfileMutation: updateProfile,
}));

const routes = [Routes.PreferenceRoute];

beforeAll(() => initTestI18n(accountZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAccountPagePermissions();
  useTimezoneStore.setState({ timezone: 'Asia/Taipei' });
  updateProfile.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

/** 打開時區下拉，搜尋並選一個時區。 */
async function pickTimezone(zone: string) {
  fireEvent.click(await screen.findByTestId('preference-timezone'));
  fireEvent.change(await screen.findByTestId('select-search'), { target: { value: zone } });
  const option = await waitFor(() => {
    const element = screen
      .getAllByTestId('select-item')
      .find((item) => item.getAttribute('data-value') === zone);
    if (!element) throw new Error(`找不到時區 ${zone}`);
    return element;
  });
  fireEvent.click(option);
}

const toasts = () => screen.queryAllByTestId('toast');

describe('偏好設定頁（docs/architecture/frontend/08-i18n.md §2.3）', () => {
  it('時區是完整、可搜尋的 IANA 清單（不只 4 個）', async () => {
    renderRoute(routes, '/preference', []);
    await pickTimezone('Europe/Berlin');
    expect(useTimezoneStore.getState().timezone).toBe('Europe/Berlin');
  });

  it('同步帳號成功之後才顯示「已儲存」', async () => {
    updateProfile.mockResolvedValue({ user: { id: 'me' }, roles: [], permissions: [] });
    renderRoute(routes, '/preference', []);
    await pickTimezone('Europe/Berlin');

    await waitFor(() => expect(updateProfile).toHaveBeenCalled());
    expect(updateProfile.mock.calls[0]?.[0]).toMatchObject({
      params: { preferences: { timezone: 'Europe/Berlin' } },
    });
    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveAttribute('data-value', 'success');
    expect(toast).toHaveTextContent('偏好已儲存');
  });

  it('同步帳號失敗（500）→ 不顯示「已儲存」，改為錯誤提示', async () => {
    updateProfile.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderRoute(routes, '/preference', []);
    await pickTimezone('Europe/Berlin');

    const toast = await screen.findByTestId('toast');
    expect(toast).toHaveAttribute('data-value', 'error');
    expect(within(toast).queryByText(/偏好已儲存/)).toBeNull();
    expect(toasts().some((item) => item.getAttribute('data-value') === 'success')).toBe(false);
  });
});
