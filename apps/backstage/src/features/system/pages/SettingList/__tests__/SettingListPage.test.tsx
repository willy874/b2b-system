import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';

import { registerSystemPagePermissions, Routes } from '../../..';

const { listSettings, updateSettings } = vi.hoisted(() => ({
  listSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock('@/apis/system/get-setting-list/query', () => ({
  SETTING_LIST_QUERY_KEY: 'SETTING_LIST_QUERY_KEY',
  getSettingListQueryOptions: () => ({
    queryKey: ['SETTING_LIST_QUERY_KEY'],
    queryFn: listSettings,
  }),
}));
vi.mock('@/apis/system/update-settings/mutation', () => ({
  getUpdateSettingsMutationOptions: () => ({ mutationFn: updateSettings }),
}));

const SETTINGS = [
  {
    key: 'auth.loginMaxAttempts',
    category: 'auth',
    type: 'number',
    value: 8,
    defaultValue: 5,
    isOverridden: true,
    isPublic: false,
    minimum: 3,
    maximum: 20,
    updatedAt: '2026-09-30T00:00:00.000Z',
  },
  {
    key: 'auth.registrationEnabled',
    category: 'auth',
    type: 'boolean',
    value: true,
    defaultValue: true,
    isOverridden: false,
    isPublic: true,
    minimum: null,
    maximum: null,
    updatedAt: null,
  },
];

function renderPage(permissions: PermissionKey[] | 'unhydrated') {
  usePermissionStore.setState(
    permissions === 'unhydrated'
      ? { permissions: new Set(), hydrated: false }
      : { permissions: new Set(permissions), hydrated: true },
  );
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.SettingListRoute]),
    history: createMemoryHistory({ initialEntries: ['/system/settings'] }),
    parseSearch,
    stringifySearch,
  });
  return render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
}

function fieldOf(key: string): HTMLElement {
  const element = screen
    .getAllByTestId('setting-field')
    .find((item) => item.getAttribute('data-value') === key);
  if (!element) throw new Error(`找不到設定欄位 ${key}`);
  return element;
}

beforeEach(() => {
  resetPagePermissionRegistry();
  registerSystemPagePermissions();
  listSettings.mockReset().mockResolvedValue({ items: SETTINGS });
  updateSettings.mockReset().mockResolvedValue({ items: SETTINGS });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('系統設定頁（docs/architecture/backend/12-settings.md）', () => {
  it('有 system:update → 可以編輯、恢復預設，改值後出現儲存按鈕並只送出改過的 key', async () => {
    renderPage(['system:read', 'system:update'] as PermissionKey[]);
    expect(await screen.findByTestId('setting-reset')).toHaveAttribute(
      'data-value',
      'auth.loginMaxAttempts',
    );
    expect(screen.queryByTestId('setting-save')).toBeNull();

    fireEvent.click(within(fieldOf('auth.registrationEnabled')).getByTestId('setting-switch'));
    fireEvent.click(await screen.findByTestId('setting-save'));

    await waitFor(() => expect(updateSettings).toHaveBeenCalled());
    expect(updateSettings.mock.calls[0]![0]).toMatchObject({
      params: { values: { 'auth.registrationEnabled': false } },
    });
  });

  it('只有 system:read → 看得到設定，但不能編輯、沒有恢復預設', async () => {
    renderPage(['system:read'] as PermissionKey[]);
    expect(await screen.findAllByTestId('setting-field')).toHaveLength(2);
    expect(
      within(fieldOf('auth.loginMaxAttempts')).getByTestId('setting-overridden'),
    ).toBeVisible();
    expect(screen.queryByTestId('setting-reset')).toBeNull();
    expect(
      within(fieldOf('auth.registrationEnabled')).getByTestId('setting-switch'),
    ).toHaveAttribute('data-disabled');
  });

  it('權限未水合 → 不閃現編輯操作', async () => {
    renderPage('unhydrated');
    expect(await screen.findByTestId('setting-page')).toBeInTheDocument();
    expect(screen.queryByTestId('setting-reset')).toBeNull();
    expect(screen.queryByTestId('setting-save')).toBeNull();
  });
});
