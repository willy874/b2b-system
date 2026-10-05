import { readPendingLogin } from '@b2b-system/web-core/auth';
import type * as Auth from '@b2b-system/web-core/auth';
import type * as Locales from '@b2b-system/web-core/locales';
import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
}

beforeEach(() => {
  sessionStorage.clear();
  assign.mockReset();
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
