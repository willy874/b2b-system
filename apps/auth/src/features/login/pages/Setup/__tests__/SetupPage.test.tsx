import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { AllProviders } from '@/test/renderWithPermissions';

import { Routes } from '../../..';

const { setup, verify, goToTenantLogin } = vi.hoisted(() => ({
  setup: vi.fn(),
  verify: vi.fn(),
  goToTenantLogin: vi.fn(),
}));
vi.mock('@/apis/auth/setup/mutation', () => ({
  getSetupMutationOptions: () => ({ mutationFn: setup }),
}));
vi.mock('@/apis/auth/setup/query', () => ({
  AUTH_SETUP_VERIFY_QUERY_KEY: 'AUTH_SETUP_VERIFY_QUERY_KEY',
  getVerifySetupQueryOptions: (token: string, tenant: string) => ({
    queryKey: ['AUTH_SETUP_VERIFY_QUERY_KEY', tenant, token],
    queryFn: () => verify(token, tenant),
  }),
}));
vi.mock('@/features/login/tenant', () => ({ goToTenantLogin }));
// 完成後導向 /login：那一頁會頂層跳轉到 IdP，測試裡不需要
vi.mock('@/features/login/sso', () => ({ startSsoLogin: () => Promise.resolve() }));

const PASSWORD = 'NewPassword!2026';

function renderAt(url: string) {
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.SetupRoute, Routes.LoginRoute]),
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

async function submit() {
  fireEvent.change(await screen.findByTestId('setup-password'), { target: { value: PASSWORD } });
  fireEvent.change(screen.getByTestId('setup-confirm'), { target: { value: PASSWORD } });
  fireEvent.click(screen.getByTestId('setup-submit'));
}

beforeEach(() => {
  setup.mockReset().mockResolvedValue({ success: true });
  verify.mockReset().mockResolvedValue({ valid: true, email: 'someone@example.com' });
  goToTenantLogin.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('設定初始密碼（租戶的帳號與平台管理者，docs/adr/0020-physical-tenant-isolation.md D5、開放問題 6）', () => {
  it('帶 ?tenant= → 租戶的帳號，完成後前往那個租戶的登入', async () => {
    renderAt('/setup?token=abcdefghijkl&tenant=acme');
    await submit();
    await waitFor(() => expect(setup).toHaveBeenCalled());
    expect(setup.mock.calls[0]?.[0]).toEqual({
      params: { tenant: 'acme', token: 'abcdefghijkl', password: PASSWORD },
    });
    await waitFor(() => expect(goToTenantLogin).toHaveBeenCalledWith('acme'));
  });

  it('沒有 ?tenant= → 平台管理者的帳號，完成後留在 apps/auth 登入', async () => {
    const router = renderAt('/setup?token=abcdefghijkl');
    await submit();
    await waitFor(() => expect(setup).toHaveBeenCalled());
    expect(setup.mock.calls[0]?.[0]).toEqual({
      params: { tenant: undefined, token: 'abcdefghijkl', password: PASSWORD },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(goToTenantLogin).not.toHaveBeenCalled();
  });

  it('token 無效 → 不顯示表單', async () => {
    verify.mockResolvedValue({ valid: false });
    renderAt('/setup?token=abcdefghijkl');
    expect(await screen.findByTestId('setup-invalid')).toBeInTheDocument();
    expect(screen.queryByTestId('setup-password')).toBeNull();
  });
});
