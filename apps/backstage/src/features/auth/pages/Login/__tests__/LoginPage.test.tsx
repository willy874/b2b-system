import { screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

import { Routes } from '../../..';
import authZhTW from '../../../locales/zh_TW.json';

const routes = [Routes.AuthRoute.addChildren([Routes.LoginRoute])];

beforeAll(() => initTestI18n(authZhTW));
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
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
