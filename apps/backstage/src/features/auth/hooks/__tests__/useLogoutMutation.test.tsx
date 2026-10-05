import { sessionStore } from '@b2b-system/web-core/auth';
import type { SessionTokens } from '@b2b-system/web-core/auth';
import { NetworkError } from '@b2b-system/web-core/client';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLogoutMutation } from '../useLogoutMutation';

const revoke = vi.fn();
vi.mock('@/apis/auth/logout/mutation', () => ({
  getLogoutMutationOptions: () => ({ mutationFn: revoke }),
}));

describe('useLogoutMutation（登出與續期的先後）', () => {
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

    const { result } = renderHook(() => useLogoutMutation(), { wrapper: AllProviders });
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

    const { result } = renderHook(() => useLogoutMutation(), { wrapper: AllProviders });
    act(() => result.current.mutate());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(revoke).toHaveBeenCalledWith({ accessToken: 'token' });
  });

  it('續期暫時失敗時仍然登出（只是無法通知後端撤銷）', async () => {
    sessionStore.setRefreshFn(() =>
      Promise.reject(new NetworkError(new TypeError('Failed to fetch'))),
    );
    sessionStore.setTokens({ accessToken: 'stale', expiresIn: 1 });

    const { result } = renderHook(() => useLogoutMutation(), { wrapper: AllProviders });
    act(() => result.current.mutate());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(revoke).not.toHaveBeenCalled();
    expect(sessionStore.hasSession()).toBe(false);
  });
});
