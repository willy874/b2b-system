import { AppError } from '@b2b-system/web-core/errors';
import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';

import { registerSettingPagePermissions, Routes } from '../../..';

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
  const result = render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
  return { ...result, router };
}

async function findFieldOf(key: string): Promise<HTMLElement> {
  await screen.findAllByTestId('setting-field');
  return fieldOf(key);
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
  registerSettingPagePermissions();
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

  describe('未儲存提醒', () => {
    it('改了值還沒儲存就換頁：先確認；選「繼續編輯」後留在原處、草稿還在', async () => {
      const { router } = renderPage(['system:read', 'system:update'] as PermissionKey[]);
      fireEvent.click(
        within(await findFieldOf('auth.registrationEnabled')).getByTestId('setting-switch'),
      );
      await screen.findByTestId('setting-save');
      router.history.push('/user');

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
      expect(router.state.location.pathname).toBe('/system/settings');
      expect(screen.getByTestId('setting-save')).toBeInTheDocument();
    });

    it('儲存之後換頁：不確認', async () => {
      const { router } = renderPage(['system:read', 'system:update'] as PermissionKey[]);
      fireEvent.click(
        within(await findFieldOf('auth.registrationEnabled')).getByTestId('setting-switch'),
      );
      fireEvent.click(await screen.findByTestId('setting-save'));
      await waitFor(() => expect(screen.queryByTestId('setting-save')).toBeNull());
      router.history.push('/user');

      await waitFor(() => expect(router.state.location.pathname).toBe('/user'));
      expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
    });
  });

  it('查詢失敗 → 顯示錯誤與重試，不是標題下方一片空白；重試成功後列出', async () => {
    listSettings.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderPage(['system:read'] as PermissionKey[]);

    expect(await screen.findByTestId('setting-error')).toBeInTheDocument();
    listSettings.mockResolvedValue({ items: SETTINGS });
    fireEvent.click(screen.getByTestId('query-error-retry'));
    expect(await screen.findAllByTestId('setting-field')).toHaveLength(2);
  });
});
