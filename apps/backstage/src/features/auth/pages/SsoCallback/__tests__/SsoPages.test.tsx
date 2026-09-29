import {
  createMemoryHistory,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthorizationUrl } from '@/core/auth';
import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { AllProviders } from '@/test/renderWithPermissions';

import { Routes } from '../../..';
import { SSO_CLIENT } from '../../../sso';

const { exchange } = vi.hoisted(() => ({ exchange: vi.fn() }));
vi.mock('@/apis/auth/sso-callback/mutation', () => ({
  getSsoCallbackMutationOptions: () => ({ mutationFn: exchange }),
}));
// 這個網域的租戶（docs/adr/0020-physical-tenant-isolation.md D7）
vi.mock('@/apis/tenant/get-current-tenant/fetcher', () => ({
  fetchCurrentTenantQuery: vi.fn(async () => ({ code: 'acme', name: 'Acme' })),
}));

const assign = vi.fn();

/** 登入後要回到的頁面（只用來確認有導過去）。 */
const TargetRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/users',
  component: () => <p data-testid="target-page">users</p>,
});

function renderAt(url: string) {
  const router = createRouter({
    routeTree: RootRoute.addChildren([
      Routes.AuthRoute.addChildren([Routes.LoginRoute, Routes.SsoCallbackRoute]),
      TargetRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [url] }),
    // 與 app 相同：search 值一律是字串（`?signedOut=true`）
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
  sessionStorage.clear();
  exchange.mockReset().mockResolvedValue({ accessToken: 'a', tokenType: 'Bearer', expiresIn: 900 });
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('登入頁（docs/adr/0019-sso-identity-platform.md）', () => {
  it('沒有 session 時直接頂層跳轉到 IdP，帶上這個網域的租戶代碼', async () => {
    renderAt('/auth/login?redirect=%2Fusers');
    await waitFor(() => expect(assign).toHaveBeenCalled());
    const url = new URL(String(assign.mock.calls[0]?.[0]));
    expect(`${url.origin}${url.pathname}`).toBe(`${SSO_CLIENT.issuer}/auth`);
    expect(url.searchParams.get('client_id')).toBe('backstage');
    expect(url.searchParams.get('tenant')).toBe('acme');
  });

  it('剛登出時不自動跳轉，按「登入」才跳', async () => {
    renderAt('/auth/login?signedOut=true');
    fireEvent.click(await screen.findByTestId('login-sso'));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
  });
});

describe('SSO callback', () => {
  it('以 state 取回 verifier，兌換後回到原本的頁面', async () => {
    const authorize = new URL(await createAuthorizationUrl(SSO_CLIENT, '/users'));
    const state = authorize.searchParams.get('state') ?? '';
    const router = renderAt(`/auth/callback?code=the-code-123&state=${state}`);

    expect(await screen.findByTestId('target-page')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/users');
    expect(exchange).toHaveBeenCalledTimes(1);
    const call = exchange.mock.calls[0]?.[0] as
      | { params: { code: string; codeVerifier: string; clientId: string; redirectUri: string } }
      | undefined;
    expect(call?.params).toMatchObject({
      code: 'the-code-123',
      clientId: 'backstage',
      redirectUri: `${window.location.origin}/auth/callback`,
    });
    expect(call?.params.codeVerifier.length).toBeGreaterThanOrEqual(43);
  });

  it('不是這個分頁發起的（沒有 verifier）或使用者取消 → 不兌換，提供重新登入', async () => {
    renderAt('/auth/callback?code=the-code-123&state=unknown');
    expect(await screen.findByTestId('sso-callback-retry')).toBeInTheDocument();
    expect(exchange).not.toHaveBeenCalled();
  });
});
