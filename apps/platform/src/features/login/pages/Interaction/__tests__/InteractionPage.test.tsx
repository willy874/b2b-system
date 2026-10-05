import { AppError } from '@b2b-system/web-core/errors';
import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Routes } from '../../..';

const { details, login, abort, discover, startExternal, publicSettings } = vi.hoisted(() => ({
  publicSettings: vi.fn(),
  details: vi.fn(),
  login: vi.fn(),
  abort: vi.fn(),
  discover: vi.fn(),
  startExternal: vi.fn(),
}));

vi.mock('@/apis/sso-interaction/get-sso-interaction/query', () => ({
  SSO_INTERACTION_QUERY_KEY: 'SSO_INTERACTION_QUERY_KEY',
  getSsoInteractionQueryOptions: (uid: string) => ({
    queryKey: ['SSO_INTERACTION_QUERY_KEY', uid],
    queryFn: details,
    retry: false,
  }),
}));
vi.mock('@/apis/auth/get-public-settings/query', () => ({
  PUBLIC_SETTINGS_QUERY_KEY: 'PUBLIC_SETTINGS_QUERY_KEY',
  getPublicSettingsQueryOptions: (tenant: string) => ({
    queryKey: ['PUBLIC_SETTINGS_QUERY_KEY', tenant],
    queryFn: () => publicSettings(tenant),
  }),
}));
vi.mock('@/apis/sso-interaction/login-sso-interaction/mutation', () => ({
  getLoginSsoInteractionMutationOptions: () => ({ mutationFn: login }),
}));
vi.mock('@/apis/sso-interaction/abort-sso-interaction/mutation', () => ({
  getAbortSsoInteractionMutationOptions: () => ({ mutationFn: abort }),
}));
vi.mock('@/apis/sso-interaction/discover-sso-interaction/query', () => ({
  SSO_DISCOVERY_QUERY_KEY: 'SSO_DISCOVERY_QUERY_KEY',
  getSsoDiscoveryQueryOptions: (uid: string, email: string) => ({
    queryKey: ['SSO_DISCOVERY_QUERY_KEY', uid, email],
    queryFn: () => discover(email),
    retry: false,
  }),
}));
vi.mock('@/apis/sso-interaction/start-external-sso-interaction/mutation', () => ({
  getStartExternalSsoInteractionMutationOptions: () => ({ mutationFn: startExternal }),
}));

const UID = 'abc12345xyz';
const TENANT_INTERACTION = {
  uid: UID,
  prompt: 'login',
  clientId: 'backstage',
  clientName: 'backstage',
  loginHint: null,
  tenant: { code: 'acme', name: 'Acme 股份有限公司' },
};
const RESUME = `http://localhost:5175/api/oidc/auth/${UID}`;
const assign = vi.fn();

const ACME = { id: '22222222-2222-4222-8222-222222222222', name: 'Acme Azure AD' };
const EXTERNAL_AUTHORIZE = 'https://login.acme.test/authorize?state=s';

function renderInteraction(query = '') {
  const router = createRouter({
    routeTree: RootRoute.addChildren([
      Routes.InteractionRoute,
      Routes.EnterTenantRoute,
      Routes.LoginRoute,
    ]),
    history: createMemoryHistory({ initialEntries: [`/interaction/${UID}${query}`] }),
    parseSearch,
    stringifySearch,
  });
  return render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
}

beforeEach(() => {
  details.mockReset().mockResolvedValue(TENANT_INTERACTION);
  publicSettings.mockReset().mockResolvedValue({
    values: { 'auth.registrationEnabled': true, 'auth.passwordMinLength': 12 },
  });
  login.mockReset().mockResolvedValue({ redirectTo: RESUME });
  abort.mockReset().mockResolvedValue({ redirectTo: `${RESUME}?aborted` });
  discover.mockReset().mockResolvedValue({ provider: null, ssoOnly: false });
  startExternal.mockReset().mockResolvedValue({ redirectTo: EXTERNAL_AUTHORIZE });
  assign.mockReset();
  // 頂層跳轉：jsdom 的 location.assign 不能 spy，整個換掉（router 用 memory history，不受影響）
  vi.stubGlobal('location', { ...window.location, assign });
  // router 換頁後會捲回頂端；jsdom 沒有實作 scrollTo
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IdP 的登入互動頁（docs/architecture/04-sso.md §12）', () => {
  it('租戶的互動：帳號流程的連結帶上租戶代碼（docs/architecture/05-tenancy.md §10.2 D8）', async () => {
    renderInteraction();
    expect(await screen.findByTestId('login-register-link')).toHaveAttribute(
      'href',
      '/register?tenant=acme',
    );
    expect(screen.getByTestId('login-forgot-password-link')).toHaveAttribute(
      'href',
      '/forgot-password?tenant=acme',
    );
  });

  it('租戶關閉了註冊（auth.registrationEnabled）→ 沒有註冊連結，忘記密碼照常', async () => {
    publicSettings.mockResolvedValue({ values: { 'auth.registrationEnabled': false } });
    renderInteraction();
    expect(await screen.findByTestId('login-forgot-password-link')).toBeInTheDocument();
    await waitFor(() => expect(publicSettings).toHaveBeenCalledWith('acme'));
    expect(screen.queryByTestId('login-register-link')).not.toBeInTheDocument();
  });

  it('平台管理者的互動（沒有租戶）：沒有註冊與忘記密碼的連結，有進入租戶的連結', async () => {
    details.mockResolvedValue({
      uid: UID,
      prompt: 'login',
      clientId: 'auth',
      clientName: 'auth',
      loginHint: null,
      tenant: null,
    });
    renderInteraction();
    expect(await screen.findByTestId('login-email')).toBeInTheDocument();
    expect(screen.queryByTestId('login-register-link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('login-forgot-password-link')).not.toBeInTheDocument();
    // 走錯地方的租戶使用者：去「進入租戶」（docs/architecture/05-tenancy.md §10.2 D11）
    expect(screen.getByTestId('login-enter-tenant-link')).toHaveAttribute('href', '/enter');
  });

  it('登入成功 → 以互動 id 送出帳密，並頂層跳轉到 resume 網址', async () => {
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret-123' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(RESUME));
    expect(login.mock.calls[0]?.[0]).toEqual({
      params: { uid: UID, email: 'user@example.com', password: 'secret-123' },
    });
  });

  it('帳密錯誤時顯示錯誤、不跳轉', async () => {
    login.mockRejectedValue(new Error('AUTH_INVALID_CREDENTIALS'));
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'wrong' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(login).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    expect(assign).not.toHaveBeenCalled();
  });

  it('取消 → 頂層跳轉到 provider（產品收到 access_denied）', async () => {
    renderInteraction();
    await waitFor(() => expect(screen.getByTestId('login-cancel')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-cancel'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`${RESUME}?aborted`));
    expect(abort.mock.calls[0]?.[0]).toEqual({ params: { uid: UID } });
  });

  it('互動無效（過期、沒有互動 cookie）→ 顯示錯誤，沒有表單', async () => {
    details.mockRejectedValue(new Error('AUTH_SSO_INTERACTION_INVALID'));
    renderInteraction();
    expect(await screen.findByTestId('interaction-invalid')).toBeInTheDocument();
    expect(screen.queryByTestId('login-submit')).toBeNull();
  });

  describe('外部 IdP（docs/architecture/04-sso.md §12.2 D8、D9）', () => {
    async function typeEmail(email: string) {
      const input = await screen.findByTestId('login-email');
      fireEvent.change(input, { target: { value: email } });
      fireEvent.blur(input);
    }

    it('網域沒有連線 → 只有密碼登入', async () => {
      renderInteraction();
      await typeEmail('user@example.com');
      await waitFor(() => expect(discover).toHaveBeenCalledWith('user@example.com'));
      expect(screen.queryByTestId('login-external')).toBeNull();
      expect(screen.getByTestId('login-password')).toBeInTheDocument();
    });

    it('網域有連線 → 多一個「使用 X 登入」，按下後頂層跳轉到外部 IdP', async () => {
      discover.mockResolvedValue({ provider: ACME, ssoOnly: false });
      renderInteraction();
      await typeEmail('alice@acme.test');
      const button = await screen.findByTestId('login-external');
      expect(button).toHaveAttribute('data-value', ACME.id);
      expect(screen.getByTestId('login-password')).toBeInTheDocument();
      await waitFor(() => expect(button).not.toBeDisabled());
      fireEvent.click(button);
      await waitFor(() => expect(assign).toHaveBeenCalledWith(EXTERNAL_AUTHORIZE));
      expect(startExternal.mock.calls[0]?.[0]).toEqual({
        params: { uid: UID, providerId: ACME.id },
      });
      expect(login).not.toHaveBeenCalled();
    });

    it('只允許 SSO 的網域 → 沒有密碼欄，送出表單就走外部 IdP', async () => {
      discover.mockResolvedValue({ provider: ACME, ssoOnly: true });
      renderInteraction();
      await typeEmail('alice@acme.test');
      expect(await screen.findByTestId('login-sso-only')).toBeInTheDocument();
      expect(screen.queryByTestId('login-password')).toBeNull();
      expect(screen.queryByTestId('login-submit')).toBeNull();
      await waitFor(() => expect(screen.getByTestId('login-external')).not.toBeDisabled());
      fireEvent.submit(screen.getByTestId('login-email').closest('form')!);
      await waitFor(() => expect(assign).toHaveBeenCalledWith(EXTERNAL_AUTHORIZE));
    });

    it('不完整的 email 不查詢網域', async () => {
      renderInteraction();
      await typeEmail('alice@');
      await waitFor(() => expect(screen.getByTestId('login-email')).toBeInTheDocument());
      expect(discover).not.toHaveBeenCalled();
    });

    it('外部登入失敗帶回的錯誤碼 → 顯示對應訊息', async () => {
      renderInteraction('?error=AUTH_SSO_ACCOUNT_NOT_FOUND');
      const error = await screen.findByTestId('login-error');
      expect(error).toHaveAttribute('data-value', 'AUTH_SSO_ACCOUNT_NOT_FOUND');
    });
  });

  it('互動已經找不到（過期）→ 提供重新開始登入：進入租戶與平台管理者登入', async () => {
    details.mockRejectedValue(new AppError('AUTH_SSO_INTERACTION_INVALID', 400));
    renderInteraction();
    expect(await screen.findByTestId('interaction-invalid')).toBeInTheDocument();
    expect(screen.getByTestId('login-restart')).toHaveAttribute('href', '/enter');
    expect(screen.getByTestId('login-restart-platform')).toHaveAttribute('href', '/login');
  });

  it('送出時才發現互動過期 → 回到那個租戶重新開始登入', async () => {
    login.mockRejectedValue(new AppError('AUTH_SSO_INTERACTION_INVALID', 400));
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret-123' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('login-restart')).toHaveAttribute(
      'href',
      '/enter?tenant=acme',
    );
    expect(screen.queryByTestId('login-restart-platform')).toBeNull();
    expect(screen.queryByTestId('login-submit')).toBeNull();
  });

  it('進頁面後游標在 Email 欄；密碼欄可以切換顯示', async () => {
    renderInteraction();
    const email = await screen.findByTestId('login-email');
    await waitFor(() => expect(email).toHaveFocus());

    const password = screen.getByTestId('login-password');
    expect(password).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByTestId('password-visibility-toggle'));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
  });

  it('互動還在載入時已經移到密碼欄 → 載入完成後不把游標搶回 Email 欄', async () => {
    let resolveDetails: ((value: unknown) => void) | undefined;
    details.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDetails = resolve;
        }),
    );
    renderInteraction();
    const password = await screen.findByTestId('login-password');
    password.focus();

    resolveDetails?.(TENANT_INTERACTION);
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());

    expect(password).toHaveFocus();
  });
});
