import { describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/core/auth';
import type { FetcherRequest, FetcherResponse } from '@/core/client';
import { AppError } from '@/core/errors';

import { apiAdapterInterceptor } from '../api-adapter';
import { authHeaderInterceptor } from '../auth';
import { refreshTokenInterceptor } from '../refresh-token';
import { retryInterceptor } from '../retry';

const request: FetcherRequest = { url: '/api/roles', init: {} };

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
});
