import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { Routes } from '../../..';
import authZhTW from '../../../locales/zh_TW.json';

const { revoke } = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock('@/apis/auth/logout/mutation', () => ({
  getLogoutMutationOptions: () => ({ mutationFn: revoke }),
}));

const routes = [Routes.AuthRoute.addChildren([Routes.LoginRoute])];

beforeAll(() => initTestI18n(authZhTW));
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  revoke.mockReset();
});

describe('backstage 的登入頁：session 結束的原因', () => {
  it('逾時結束 → 說明登入已過期，不顯示「你已登出」', async () => {
    renderRoute(routes, '/auth/login?signedOut=true&reason=AUTH_REFRESH_EXPIRED', []);
    expect(await screen.findByText(/過期/)).toBeInTheDocument();
    expect(screen.queryByText(/你已登出/)).not.toBeInTheDocument();
  });

  it('變更密碼 → 請用新密碼登入', async () => {
    renderRoute(routes, '/auth/login?signedOut=true&reason=password_changed', []);
    expect(await screen.findByText(/請用新密碼重新登入/)).toBeInTheDocument();
  });

  it('自己登出（沒有原因）→ 一般的「已登出」說明', async () => {
    renderRoute(routes, '/auth/login?signedOut=true', []);
    expect(await screen.findByText(/你已登出/)).toBeInTheDocument();
  });
});

describe('backstage 的登入頁：伺服器端的登出沒有完成（docs/architecture/04-sso.md §3.4）', () => {
  const INCOMPLETE_URL = '/auth/login?signedOut=true&logout=incomplete';

  it('logout=incomplete → 顯示警示與「重試登出」，不說「你已登出」', async () => {
    renderRoute(routes, INCOMPLETE_URL, []);

    const alert = await screen.findByTestId('logout-incomplete');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('伺服器端的登出沒有完成');
    expect(within(alert).getByTestId('logout-retry')).toHaveTextContent('重試登出');
    expect(screen.queryByText(/你已登出/)).not.toBeInTheDocument();
  });

  it('★ 重試成功：以 refresh cookie 撤銷（不帶 token），回到一般的「已登出」說明', async () => {
    revoke.mockResolvedValue({ success: true });
    const { router } = renderRoute(routes, INCOMPLETE_URL, []);

    fireEvent.click(await screen.findByTestId('logout-retry'));

    await waitFor(() => expect(screen.queryByTestId('logout-incomplete')).not.toBeInTheDocument());
    expect(revoke).toHaveBeenCalledWith({});
    expect(await screen.findByText(/你已登出/)).toBeInTheDocument();
    expect(router.state.location.search).not.toHaveProperty('logout');
  });

  it('重試仍失敗：顯示原因，並提供前往 IdP 登出的連結', async () => {
    revoke.mockRejectedValue(new AppError('AUTH_REFRESH_INVALID', 401));
    renderRoute(routes, INCOMPLETE_URL, []);

    fireEvent.click(await screen.findByTestId('logout-retry'));

    const link = await screen.findByTestId('logout-end-idp-session');
    expect(link.getAttribute('href')).toMatch(/\/session\/end\?client_id=backstage&/);
    expect(
      new URL(link.getAttribute('href') ?? '').searchParams.get('post_logout_redirect_uri'),
    ).toBe(`${location.origin}/auth/login`);
    expect(screen.getByTestId('logout-retry-error')).toBeInTheDocument();
    expect(screen.getByTestId('logout-incomplete')).toBeInTheDocument();
  });
});
