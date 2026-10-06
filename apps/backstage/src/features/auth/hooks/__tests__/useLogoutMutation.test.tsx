import { sessionStore } from '@b2b-system/web-core/auth';
import type { SessionTokens } from '@b2b-system/web-core/auth';
import { NetworkError } from '@b2b-system/web-core/client';
import { AppError } from '@b2b-system/web-core/errors';
import { parseSearch, stringifySearch } from '@b2b-system/web-core/router';
import { AllProviders } from '@b2b-system/web-core/testing';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLogoutMutation } from '../useLogoutMutation';

const revoke = vi.fn();
vi.mock('@/apis/auth/logout/mutation', () => ({
  getLogoutMutationOptions: () => ({ mutationFn: revoke }),
}));

const LOGIN_PATH = '/auth/login';

/** 登出時在使用者列表；外框不在這裡，所以 session 結束不會先導到登入頁（那是 SessionWatcher 的事）。 */
function renderLogout() {
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/list' }),
      createRoute({ getParentRoute: () => root, path: LOGIN_PATH }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/list'] }),
    parseSearch,
    stringifySearch,
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AllProviders>
      <RouterContextProvider router={router}>{children}</RouterContextProvider>
    </AllProviders>
  );
  const hook = renderHook(() => useLogoutMutation(), { wrapper });
  return { ...hook, router };
}

describe('useLogoutMutation（登出與續期的先後、登出未完成；docs/architecture/04-sso.md §3.4）', () => {
  beforeEach(() => {
    revoke.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    sessionStore.clear();
  });

  it('★ 續期進行中按登出：等續期完成才結束 session，用新 token 撤銷後端，且 session 不復活', async () => {
    let resolveRefresh: ((value: SessionTokens) => void) | undefined;
    sessionStore.setRefreshFn(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    sessionStore.setTokens({ accessToken: 'stale', expiresIn: 1 });
    const inFlightRequest = sessionStore.ensureAccessToken();
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined());

    const { result } = renderLogout();
    act(() => result.current.mutate());
    resolveRefresh?.({ accessToken: 'fresh', expiresIn: 300 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await inFlightRequest;
    expect(revoke).toHaveBeenCalledWith({ accessToken: 'fresh' });
    expect(sessionStore.getAccessToken()).toBeUndefined();
    expect(sessionStore.hasSession()).toBe(false);
  });

  it('撤銷請求送出前，前端 session 已經結束', async () => {
    sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });
    revoke.mockImplementation(() => {
      expect(sessionStore.hasSession()).toBe(false);
      return Promise.resolve({ success: true });
    });

    const { result, router } = renderLogout();
    act(() => result.current.mutate());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(revoke).toHaveBeenCalledWith({ accessToken: 'token' });
    expect(router.history.location.search).not.toContain('logout=');
  });

  it('★ 續期暫時失敗時仍然登出，並改以 refresh cookie 撤銷後端（不帶 accessToken）', async () => {
    sessionStore.setRefreshFn(() =>
      Promise.reject(new NetworkError(new TypeError('Failed to fetch'))),
    );
    sessionStore.setTokens({ accessToken: 'stale', expiresIn: 1 });

    const { result, router } = renderLogout();
    act(() => result.current.mutate());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(revoke).toHaveBeenCalledWith({});
    expect(sessionStore.hasSession()).toBe(false);
    expect(router.history.location.search).not.toContain('logout=');
  });

  it.each([
    ['NetworkError', new NetworkError(new TypeError('Failed to fetch'))],
    ['500', new AppError('INTERNAL_ERROR', 500)],
    ['429', new AppError('RATE_LIMITED', 429)],
  ])('★ 撤銷失敗（%s）→ 已登出頁標記 logout=incomplete', async (_name, error) => {
    sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });
    revoke.mockRejectedValue(error);

    const { result, router } = renderLogout();
    act(() => result.current.mutate());

    await waitFor(() => expect(router.history.location.pathname).toBe(LOGIN_PATH));
    const search = new URLSearchParams(router.history.location.search);
    expect(search.get('signedOut')).toBe('true');
    expect(search.get('logout')).toBe('incomplete');
    expect(sessionStore.hasSession()).toBe(false);
  });
});
