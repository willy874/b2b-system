import { readPendingLogin } from '@b2b-system/web-core/auth';
import type * as Auth from '@b2b-system/web-core/auth';
import { AppError } from '@b2b-system/web-core/errors';
import type * as Locales from '@b2b-system/web-core/locales';
import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Routes } from '../../..';

// 測試環境沒有載入語系：t() 回傳語系鍵，才看得出顯示的是哪一則說明
vi.mock('@b2b-system/web-core/locales', async (importOriginal) => {
  const actual = await importOriginal<typeof Locales>();
  const t = (key: string) => key;
  return {
    ...actual,
    useTranslation: () => ({ t, language: 'zh_TW', changeLanguage: actual.changeLanguage }),
  };
});

const { createUrl } = vi.hoisted(() => ({ createUrl: vi.fn() }));
vi.mock('@b2b-system/web-core/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof Auth>();
  createUrl.mockImplementation(actual.createAuthorizationUrl);
  return { ...actual, createAuthorizationUrl: createUrl };
});

const { revoke } = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock('@/apis/auth/logout/mutation', () => ({
  getLogoutMutationOptions: () => ({ mutationFn: revoke }),
}));

const assign = vi.fn();

function renderAt(url: string) {
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.LoginRoute]),
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
  sessionStorage.clear();
  assign.mockReset();
  revoke.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apps/platform 的登入頁（平台管理者經 SSO 登入）', () => {
  it('session 逾時結束 → 說明原因，不自動跳轉；重新登入回到原本的網址', async () => {
    renderAt(
      '/login?signedOut=true&reason=AUTH_REFRESH_EXPIRED&redirect=%2Ftenant%3Fstatus%3Dfailed',
    );
    expect(await screen.findByText('error.AUTH_REFRESH_EXPIRED')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('login-sso'));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const url = new URL(String(assign.mock.calls[0]?.[0]));
    expect(readPendingLogin(url.searchParams.get('state') ?? '')?.returnTo).toBe(
      '/tenant?status=failed',
    );
  });

  it('自己登出（沒有原因）→ 一般的「已登出」說明', async () => {
    renderAt('/login?signedOut=true');
    expect(await screen.findByText('login.signedOut')).toBeInTheDocument();
  });

  it('跳轉前失敗 → 顯示原因並可重試', async () => {
    createUrl.mockRejectedValueOnce(new Error('crypto unavailable'));
    renderAt('/login');
    expect(await screen.findByTestId('login-error')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('login-sso'));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
  });
});

describe('apps/platform 的登入頁：伺服器端的登出沒有完成（docs/architecture/04-sso.md §3.4）', () => {
  const INCOMPLETE_URL = '/login?signedOut=true&logout=incomplete';

  it('logout=incomplete → 顯示警示與「重試登出」，不說「你已登出」、不自動跳轉', async () => {
    renderAt(INCOMPLETE_URL);

    const alert = await screen.findByTestId('logout-incomplete');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('login.logoutIncomplete');
    expect(within(alert).getByTestId('logout-retry')).toHaveTextContent('login.retryLogout');
    expect(screen.queryByText('login.signedOut')).not.toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it('★ 重試成功：以 refresh cookie 撤銷（不帶 token），回到一般的「已登出」說明', async () => {
    revoke.mockResolvedValue({ success: true });
    const router = renderAt(INCOMPLETE_URL);

    fireEvent.click(await screen.findByTestId('logout-retry'));

    await waitFor(() => expect(screen.queryByTestId('logout-incomplete')).not.toBeInTheDocument());
    expect(revoke).toHaveBeenCalledWith({});
    expect(await screen.findByText('login.signedOut')).toBeInTheDocument();
    expect(router.state.location.search).not.toHaveProperty('logout');
  });

  it('重試仍失敗：顯示原因，並提供前往 IdP 登出的連結', async () => {
    revoke.mockRejectedValue(new AppError('AUTH_REFRESH_INVALID', 401));
    renderAt(INCOMPLETE_URL);

    fireEvent.click(await screen.findByTestId('logout-retry'));

    const link = await screen.findByTestId('logout-end-idp-session');
    expect(link.getAttribute('href')).toMatch(/\/session\/end\?client_id=auth&/);
    expect(screen.getByTestId('logout-retry-error')).toBeInTheDocument();
  });
});
