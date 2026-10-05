import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Routes } from '../../..';

const { reset, goToTenantLogin } = vi.hoisted(() => ({
  reset: vi.fn(),
  goToTenantLogin: vi.fn(),
}));
vi.mock('@/apis/auth/reset-password/mutation', () => ({
  getResetPasswordMutationOptions: () => ({ mutationFn: reset }),
}));
vi.mock('@/features/login/tenant', () => ({ goToTenantLogin }));
// 租戶沒有調整密碼長度
vi.mock('@/apis/auth/get-public-settings/query', () => ({
  PUBLIC_SETTINGS_QUERY_KEY: 'PUBLIC_SETTINGS_QUERY_KEY',
  getPublicSettingsQueryOptions: (tenant: string) => ({
    queryKey: ['PUBLIC_SETTINGS_QUERY_KEY', tenant],
    queryFn: () => Promise.resolve({ values: { 'auth.passwordMinLength': 12 } }),
  }),
}));
// 完成後導向 /login：那一頁會頂層跳轉到 IdP，測試裡不需要
vi.mock('@/features/login/sso', () => ({ startSsoLogin: () => Promise.resolve() }));

const PASSWORD = 'NewPassword!2026';

function renderAt(url: string) {
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.ResetPasswordRoute, Routes.LoginRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
    parseSearch,
    stringifySearch,
  });
  render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
  return router;
}

beforeEach(() => {
  reset.mockReset().mockResolvedValue({ success: true });
  goToTenantLogin.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('重設密碼（租戶的帳號與平台管理者）', () => {
  it('沒有 ?tenant= → 平台管理者的帳號，完成後留在 apps/platform 登入', async () => {
    const router = renderAt('/reset-password?token=abcdefghijkl');
    const inputs = await screen.findAllByDisplayValue('');
    fireEvent.change(inputs[0]!, { target: { value: PASSWORD } });
    fireEvent.change(inputs[1]!, { target: { value: PASSWORD } });
    fireEvent.submit(inputs[0]!.closest('form')!);
    await waitFor(() => expect(reset).toHaveBeenCalled());
    expect(reset.mock.calls[0]?.[0]).toEqual({
      params: { tenant: undefined, token: 'abcdefghijkl', newPassword: PASSWORD },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
  });

  it('沒有 token → 顯示連結無效', async () => {
    renderAt('/reset-password');
    expect(await screen.findByTestId('reset-password-invalid')).toBeInTheDocument();
  });
});
