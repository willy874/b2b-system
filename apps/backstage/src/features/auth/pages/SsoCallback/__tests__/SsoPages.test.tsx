import { createAuthorizationUrl, readPendingLogin } from '@b2b-system/web-core/auth';
import { AppError } from '@b2b-system/web-core/errors';
import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { AllProviders } from '@b2b-system/web-core/testing';
import {
  createMemoryHistory,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchCurrentTenantQuery } from '@/apis/tenant/get-current-tenant/fetcher';
import { initTestI18n } from '@/test/i18n';

import { Routes } from '../../..';
import { SSO_CLIENT } from '../../../sso';

const { exchange } = vi.hoisted(() => ({ exchange: vi.fn() }));
vi.mock('@/apis/auth/sso-callback/mutation', () => ({
  getSsoCallbackMutationOptions: () => ({ mutationFn: exchange }),
}));
// 這個網域的租戶（docs/architecture/05-tenancy.md §10.2 D7）
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

describe('登入頁（docs/architecture/04-sso.md §12）', () => {
  it('沒有 session 時直接頂層跳轉到 IdP，帶上這個網域的租戶代碼', async () => {
    renderAt('/auth/login?redirect=%2Fusers');
    await waitFor(() => expect(assign).toHaveBeenCalled());
    const url = new URL(String(assign.mock.calls[0]?.[0]));
    expect(`${url.origin}${url.pathname}`).toBe(`${SSO_CLIENT.issuer}/auth`);
    expect(url.searchParams.get('client_id')).toBe('backstage');
    expect(url.searchParams.get('tenant')).toBe('acme');
  });

  it('跳轉前失敗（租戶無法使用）→ 顯示原因並可重試', async () => {
    vi.mocked(fetchCurrentTenantQuery).mockRejectedValueOnce(
      new AppError('TENANT_UNAVAILABLE', 503),
    );
    renderAt('/auth/login?redirect=%2Fusers');
    expect(await screen.findByTestId('login-error')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('login-sso'));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('login-error')).toBeNull());
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

  it('callback 失敗後重新登入，回到原本要去的頁面', async () => {
    const authorize = new URL(await createAuthorizationUrl(SSO_CLIENT, '/users?page=2'));
    const state = authorize.searchParams.get('state') ?? '';
    renderAt(`/auth/callback?error=access_denied&state=${state}`);

    fireEvent.click(await screen.findByTestId('sso-callback-retry'));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const retried = new URL(String(assign.mock.calls[0]?.[0]));
    expect(readPendingLogin(retried.searchParams.get('state') ?? '')?.returnTo).toBe(
      '/users?page=2',
    );
  });

  it('重新登入時查不到租戶（api 不通）→ 顯示原因，按鈕可以再按', async () => {
    await initTestI18n();
    renderAt('/auth/callback?code=the-code-123&state=unknown');
    const retry = await screen.findByTestId('sso-callback-retry');
    // 頁面載入時也會查租戶：等畫面出來之後才讓下一次查詢失敗
    vi.mocked(fetchCurrentTenantQuery).mockRejectedValueOnce(
      new AppError('TENANT_UNAVAILABLE', 503),
    );
    fireEvent.click(retry);
    expect(await screen.findByText('這個租戶目前無法使用，請聯絡平台管理員。')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByTestId('sso-callback-retry')).toBeEnabled();

    fireEvent.click(screen.getByTestId('sso-callback-retry'));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
  });
});
