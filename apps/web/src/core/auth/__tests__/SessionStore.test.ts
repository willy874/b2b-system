import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkError } from '@/core/client';
import { AppError } from '@/core/errors';

import { SessionStore } from '../SessionStore';

function createStore(): SessionStore {
  return new SessionStore();
}

describe('SessionStore', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
  });

  it('新鮮的 token 直接回傳，不觸發續期', async () => {
    const store = createStore();
    const refresh = vi.fn();
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'token-1', expiresIn: 300 });

    await expect(store.ensureAccessToken()).resolves.toBe('token-1');
    expect(refresh).not.toHaveBeenCalled();
    store.destroy();
  });

  it('剩餘壽命 < 30 秒時先續期', async () => {
    const store = createStore();
    const refresh = vi.fn().mockResolvedValue({ accessToken: 'token-2', expiresIn: 300 });
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'token-1', expiresIn: 10 });

    await expect(store.ensureAccessToken()).resolves.toBe('token-2');
    expect(refresh).toHaveBeenCalledOnce();
    store.destroy();
  });

  it('★ 單飛：同時多個請求只觸發一次續期', async () => {
    const store = createStore();
    let resolveRefresh: ((value: { accessToken: string; expiresIn: number }) => void) | undefined;
    const refresh = vi.fn(
      () =>
        new Promise<{ accessToken: string; expiresIn: number }>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });

    const first = store.ensureAccessToken();
    const second = store.ensureAccessToken();
    // refreshFn 在 waitForPeerRefresh 之後才被呼叫，等一個 microtask
    await vi.waitFor(() => expect(resolveRefresh).toBeDefined());
    resolveRefresh?.({ accessToken: 'fresh', expiresIn: 300 });

    await expect(first).resolves.toBe('fresh');
    await expect(second).resolves.toBe('fresh');
    expect(refresh).toHaveBeenCalledOnce();
    store.destroy();
  });

  it('沒有 session 時不嘗試續期', async () => {
    const store = createStore();
    const refresh = vi.fn();
    store.setRefreshFn(refresh);
    await expect(store.ensureAccessToken()).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
    store.destroy();
  });

  it('endSession 是 latched：只觸發一次', () => {
    const store = createStore();
    const listener = vi.fn();
    store.events.on('ended', listener);
    store.setTokens({ accessToken: 'token', expiresIn: 300 });

    store.endSession('AUTH_TOKEN_STALE');
    store.endSession('AUTH_REFRESH_REUSED');

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith('AUTH_TOKEN_STALE');
    expect(store.getAccessToken()).toBeUndefined();
    store.destroy();
  });

  it('access token 不進 localStorage（只有「有無 session」的旗標）', () => {
    const store = createStore();
    store.setTokens({ accessToken: 'super-secret-token', expiresIn: 300 });
    const dump = JSON.stringify(globalThis.localStorage);
    expect(dump).not.toContain('super-secret-token');
    expect(store.hasSession()).toBe(true);
    store.destroy();
  });

  it('續期被伺服器拒絕時結束 session（refresh token 過期或帳號被停用）', async () => {
    const store = createStore();
    store.setRefreshFn(() => Promise.reject(new AppError('AUTH_REFRESH_REVOKED', 401)));
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });
    const ended = vi.fn();
    store.events.on('ended', ended);

    await expect(store.ensureAccessToken()).rejects.toThrow(/AUTH_REFRESH_REVOKED/);
    expect(ended).toHaveBeenCalledOnce();
    expect(store.hasSession()).toBe(false);
    store.destroy();
  });

  it.each([
    ['網路錯誤', new NetworkError(new TypeError('Failed to fetch'))],
    ['5xx', new AppError('INTERNAL_ERROR', 503)],
    ['速率限制', new AppError('RATE_LIMITED', 429)],
  ])('★ 續期暫時性失敗（%s）不結束 session，下一次會再試', async (_label, failure) => {
    const store = createStore();
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ accessToken: 'fresh', expiresIn: 300 });
    store.setRefreshFn(refresh);
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });
    const ended = vi.fn();
    store.events.on('ended', ended);

    await expect(store.ensureAccessToken()).rejects.toBe(failure);
    expect(ended).not.toHaveBeenCalled();
    expect(store.hasSession()).toBe(true);

    await expect(store.ensureAccessToken()).resolves.toBe('fresh');
    store.destroy();
  });

  it('沒有注入 refreshFn 時明確報錯', async () => {
    const store = createStore();
    store.setTokens({ accessToken: 'stale', expiresIn: 1 });
    await expect(store.ensureAccessToken()).rejects.toThrow(/refreshFn/);
    store.destroy();
  });

  it('clear 之後 hasSession 為 false', () => {
    const store = createStore();
    store.setTokens({ accessToken: 'token', expiresIn: 300 });
    store.clear();
    expect(store.hasSession()).toBe(false);
    expect(store.getAccessToken()).toBeUndefined();
    store.destroy();
  });

  it('subscribe 在登入 / 登出時通知（讓 React 重新渲染）', () => {
    const store = createStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.setTokens({ accessToken: 'token', expiresIn: 300 });
    store.endSession('logout');
    expect(listener).toHaveBeenCalledTimes(3); // setTokens + clear + endSession 的 notify
    store.destroy();
  });
});
