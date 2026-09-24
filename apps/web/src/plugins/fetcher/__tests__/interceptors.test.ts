import { describe, expect, it, vi } from 'vitest';

import { SessionStore, sessionStore } from '@/core/auth';
import { AbortReason, NetworkError, RequestAbortedError } from '@/core/client';
import type { FetcherRequest, FetcherResponse } from '@/core/client';
import { AppError } from '@/core/errors';

import { apiAdapterInterceptor } from '../api-adapter';
import { createAuthHeaderInterceptor } from '../auth';
import { createRefreshTokenInterceptor } from '../refresh-token';
import { retryInterceptor } from '../retry';

const authHeaderInterceptor = createAuthHeaderInterceptor(sessionStore);
const refreshTokenInterceptor = createRefreshTokenInterceptor(sessionStore);

const request: FetcherRequest = {
  url: '/api/roles',
  init: {},
  signal: new AbortController().signal,
};

const withInit = (init: RequestInit, signal = request.signal): FetcherRequest => ({
  ...request,
  init,
  signal,
});

const withToken = (token: string) => withInit({ headers: { authorization: `Bearer ${token}` } });

const response = (status: number, data: unknown): FetcherResponse => ({
  status,
  data,
  headers: new Headers(),
});

describe('api-adapter 攔截器', () => {
  it('剝掉成功回應的 { data } 外層', async () => {
    const result = await apiAdapterInterceptor(response(200, { data: { id: 'role-1' } }), request);
    expect(result.data).toEqual({ id: 'role-1' });
  });

  it('把錯誤信封轉成 AppError（含 code / details / requestId）', async () => {
    const envelope = {
      error: {
        code: 'AUTHZ_FORBIDDEN',
        message: 'forbidden',
        details: { missing: ['role:read'] },
        requestId: 'req-1',
      },
    };
    await expect(apiAdapterInterceptor(response(403, envelope), request)).rejects.toMatchObject({
      code: 'AUTHZ_FORBIDDEN',
      status: 403,
      details: { missing: ['role:read'] },
      requestId: 'req-1',
    });
  });

  it('沒有 code 時退回 INTERNAL_ERROR', async () => {
    await expect(apiAdapterInterceptor(response(500, {}), request)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });
});

describe('auth 攔截器', () => {
  it('取得 token 後加上 Authorization', async () => {
    sessionStore.setTokens({ accessToken: 'token-1', expiresIn: 300 });
    const result = await authHeaderInterceptor(request);
    expect(new Headers(result.init.headers).get('authorization')).toBe('Bearer token-1');
    sessionStore.clear();
  });

  it('沒有 session 時不加標頭（例如登入前）', async () => {
    sessionStore.clear();
    const result = await authHeaderInterceptor(request);
    expect(new Headers(result.init.headers).get('authorization')).toBeNull();
  });
});

describe('retry 攔截器', () => {
  it('4xx 不重試', async () => {
    const retry = vi.fn();
    await expect(
      retryInterceptor(new AppError('ROLE_NOT_FOUND', 404), request, retry),
    ).rejects.toBeInstanceOf(AppError);
    expect(retry).not.toHaveBeenCalled();
  });

  it('5xx 會重試並在成功時回傳結果', async () => {
    const retry = vi.fn().mockResolvedValue(response(200, { data: 'ok' }));
    const result = await retryInterceptor(new AppError('INTERNAL_ERROR', 500), request, retry);
    expect(result.status).toBe(200);
    expect(retry).toHaveBeenCalled();
  });

  it('網路錯誤（NetworkError）會重試', async () => {
    const retry = vi.fn().mockResolvedValue(response(200, 'ok'));
    await retryInterceptor(new NetworkError(new TypeError('Failed to fetch')), request, retry);
    expect(retry).toHaveBeenCalledOnce();
  });

  it('程式錯誤（非 NetworkError 的 TypeError）不重試', async () => {
    const retry = vi.fn();
    const bug = new TypeError('x is not a function');
    await expect(retryInterceptor(bug, request, retry)).rejects.toBe(bug);
    expect(retry).not.toHaveBeenCalled();
  });

  it('★ 非冪等方法（POST）不重試：避免重複寫入與 refresh token 重用', async () => {
    const retry = vi.fn();
    const error = new AppError('INTERNAL_ERROR', 500);
    await expect(retryInterceptor(error, withInit({ method: 'POST' }), retry)).rejects.toBe(error);
    expect(retry).not.toHaveBeenCalled();
  });

  it('★ 等待重試時被中止 → 丟 RequestAbortedError，不再送出', async () => {
    const controller = new AbortController();
    const retry = vi.fn();
    const pending = retryInterceptor(
      new AppError('INTERNAL_ERROR', 500),
      withInit({}, controller.signal),
      retry,
    );
    controller.abort(new RequestAbortedError(AbortReason.CALLER));

    await expect(pending).rejects.toMatchObject({ reason: AbortReason.CALLER });
    expect(retry).not.toHaveBeenCalled();
  });

  it('中止錯誤本身不重試', async () => {
    const retry = vi.fn();
    const aborted = new RequestAbortedError(AbortReason.TIMEOUT);
    await expect(retryInterceptor(aborted, request, retry)).rejects.toBe(aborted);
    expect(retry).not.toHaveBeenCalled();
  });

  it('★ 被拒的 token 尚未到期也要強制續期，再重放', async () => {
    const refreshFn = vi.fn().mockResolvedValue({ accessToken: 'token-2', expiresIn: 300 });
    sessionStore.setRefreshFn(refreshFn);
    sessionStore.setTokens({ accessToken: 'token-1', expiresIn: 300 });
    const retry = vi.fn().mockResolvedValue(response(200, 'ok'));

    await refreshTokenInterceptor(
      new AppError('AUTH_TOKEN_INVALID', 401),
      withToken('token-1'),
      retry,
    );

    expect(refreshFn).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledOnce();
    expect(sessionStore.getAccessToken()).toBe('token-2');
    sessionStore.clear();
  });

  it('token 已被其他請求換新 → 不重複續期，直接重放', async () => {
    const refreshFn = vi.fn();
    sessionStore.setRefreshFn(refreshFn);
    sessionStore.setTokens({ accessToken: 'token-2', expiresIn: 300 });
    const retry = vi.fn().mockResolvedValue(response(200, 'ok'));

    await refreshTokenInterceptor(
      new AppError('AUTH_TOKEN_INVALID', 401),
      withToken('token-1'),
      retry,
    );

    expect(refreshFn).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
    sessionStore.clear();
  });

  it('等待續期時本請求被中止 → 不結束 session', async () => {
    let finishRefresh: (() => void) | undefined;
    sessionStore.setRefreshFn(
      () =>
        new Promise((resolve) => {
          finishRefresh = () => resolve({ accessToken: 'token-2', expiresIn: 300 });
        }),
    );
    sessionStore.setTokens({ accessToken: 'token-1', expiresIn: 300 });
    const ended = vi.fn();
    const off = sessionStore.events.on('ended', ended);
    const controller = new AbortController();
    const retry = vi.fn();

    const pending = refreshTokenInterceptor(
      new AppError('AUTH_TOKEN_INVALID', 401),
      withInit({ headers: { authorization: 'Bearer token-1' } }, controller.signal),
      retry,
    );
    controller.abort(new RequestAbortedError(AbortReason.CALLER));

    await expect(pending).rejects.toBeInstanceOf(RequestAbortedError);
    expect(ended).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    finishRefresh?.();
    off();
    sessionStore.clear();
  });
});

describe('refresh-token 攔截器', () => {
  it('終止類錯誤碼直接結束 session，不重試', async () => {
    sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 });
    const ended = vi.fn();
    sessionStore.events.on('ended', ended);
    const retry = vi.fn();

    await expect(
      refreshTokenInterceptor(new AppError('AUTH_TOKEN_STALE', 401), request, retry),
    ).rejects.toBeInstanceOf(AppError);
    expect(retry).not.toHaveBeenCalled();
    expect(ended).toHaveBeenCalledWith('AUTH_TOKEN_STALE');
    sessionStore.events.off('ended', ended);
  });

  it('非 401 的錯誤原樣往外拋', async () => {
    const retry = vi.fn();
    await expect(
      refreshTokenInterceptor(new AppError('ROLE_IN_USE', 409), request, retry),
    ).rejects.toMatchObject({ code: 'ROLE_IN_USE' });
    expect(retry).not.toHaveBeenCalled();
  });

  it('★ 被拒的 token 尚未到期也要強制續期，再重放', async () => {
    const refreshFn = vi.fn().mockResolvedValue({ accessToken: 'token-2', expiresIn: 300 });
    sessionStore.setRefreshFn(refreshFn);
    sessionStore.setTokens({ accessToken: 'token-1', expiresIn: 300 });
    const retry = vi.fn().mockResolvedValue(response(200, 'ok'));

    await refreshTokenInterceptor(
      new AppError('AUTH_TOKEN_INVALID', 401),
      withToken('token-1'),
      retry,
    );

    expect(refreshFn).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledOnce();
    expect(sessionStore.getAccessToken()).toBe('token-2');
    sessionStore.clear();
  });

  it('token 已被其他請求換新 → 不重複續期，直接重放', async () => {
    const refreshFn = vi.fn();
    sessionStore.setRefreshFn(refreshFn);
    sessionStore.setTokens({ accessToken: 'token-2', expiresIn: 300 });
    const retry = vi.fn().mockResolvedValue(response(200, 'ok'));

    await refreshTokenInterceptor(
      new AppError('AUTH_TOKEN_INVALID', 401),
      withToken('token-1'),
      retry,
    );

    expect(refreshFn).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
    sessionStore.clear();
  });

  it('等待續期時本請求被中止 → 不結束 session', async () => {
    let finishRefresh: (() => void) | undefined;
    sessionStore.setRefreshFn(
      () =>
        new Promise((resolve) => {
          finishRefresh = () => resolve({ accessToken: 'token-2', expiresIn: 300 });
        }),
    );
    sessionStore.setTokens({ accessToken: 'token-1', expiresIn: 300 });
    const ended = vi.fn();
    const off = sessionStore.events.on('ended', ended);
    const controller = new AbortController();
    const retry = vi.fn();

    const pending = refreshTokenInterceptor(
      new AppError('AUTH_TOKEN_INVALID', 401),
      withInit({ headers: { authorization: 'Bearer token-1' } }, controller.signal),
      retry,
    );
    controller.abort(new RequestAbortedError(AbortReason.CALLER));

    await expect(pending).rejects.toBeInstanceOf(RequestAbortedError);
    expect(ended).not.toHaveBeenCalled();
    expect(retry).not.toHaveBeenCalled();
    finishRefresh?.();
    off();
    sessionStore.clear();
  });

  it('★ 續期時網路失敗 → 不結束 session，丟出網路錯誤交給 retry', async () => {
    const networkError = new NetworkError(new TypeError('Failed to fetch'));
    sessionStore.setRefreshFn(() => Promise.reject(networkError));
    sessionStore.setTokens({ accessToken: 'token-1', expiresIn: 300 });
    const ended = vi.fn();
    const off = sessionStore.events.on('ended', ended);
    const retry = vi.fn();

    await expect(
      refreshTokenInterceptor(new AppError('AUTH_TOKEN_INVALID', 401), withToken('token-1'), retry),
    ).rejects.toBe(networkError);
    expect(ended).not.toHaveBeenCalled();
    expect(sessionStore.hasSession()).toBe(true);
    expect(retry).not.toHaveBeenCalled();
    off();
    sessionStore.clear();
  });

  it('續期被伺服器拒絕 → 結束 session，對呼叫端回報原本的 401', async () => {
    sessionStore.setRefreshFn(() => Promise.reject(new AppError('AUTH_REFRESH_REVOKED', 401)));
    sessionStore.setTokens({ accessToken: 'token-1', expiresIn: 300 });
    const ended = vi.fn();
    const off = sessionStore.events.on('ended', ended);
    const original = new AppError('AUTH_TOKEN_INVALID', 401);

    await expect(refreshTokenInterceptor(original, withToken('token-1'), vi.fn())).rejects.toBe(
      original,
    );
    expect(ended).toHaveBeenCalledWith('AUTH_REFRESH_REVOKED');
    off();
  });

  it('★ 只結束自己綁定的 session：其他後端的終止錯誤不會讓主 session 登出', async () => {
    const other = new SessionStore('other-backend');
    other.setTokens({ accessToken: 'other-token', expiresIn: 300 });
    sessionStore.setTokens({ accessToken: 'main-token', expiresIn: 300 });
    const mainEnded = vi.fn();
    const off = sessionStore.events.on('ended', mainEnded);

    await expect(
      createRefreshTokenInterceptor(other)(new AppError('AUTH_TOKEN_STALE', 401), request, vi.fn()),
    ).rejects.toBeInstanceOf(AppError);

    expect(other.hasSession()).toBe(false);
    expect(mainEnded).not.toHaveBeenCalled();
    expect(sessionStore.getAccessToken()).toBe('main-token');
    off();
    other.destroy();
    sessionStore.clear();
  });
});
