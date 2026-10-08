import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { CLEAR_SITE_DATA_CACHE } from '@/core/http';

import { AuthController } from '../auth.controller';
import type { IssuedSession } from '../auth.service';

const COOKIE = 'b2b_refresh';
const COOKIE_PATH = '/api/auth';
const ACTOR = { id: 'u1' } as AuthUser;

const SESSION = {
  accessToken: 'access-1',
  expiresIn: 900,
  refreshToken: 'refresh-raw',
  refreshTtlSeconds: 3600,
} as unknown as IssuedSession;

function setup(env: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    REFRESH_COOKIE_NAME: COOKIE,
    REFRESH_COOKIE_PATH: COOKIE_PATH,
    NODE_ENV: 'development',
    ...env,
  };
  const authService = {
    login: vi.fn(async () => SESSION),
    refresh: vi.fn(async () => SESSION),
    logout: vi.fn(async () => ({ endSessionUrl: null })),
    getProfile: vi.fn(async () => ({ id: 'u1' })),
    updateProfile: vi.fn(async () => ({ id: 'u1', displayName: 'New' })),
    changePassword: vi.fn(async () => undefined),
    register: vi.fn(async () => ({ submitted: true })),
    forgotPassword: vi.fn(async () => ({ sent: true })),
    resetPassword: vi.fn(async () => undefined),
    verifySetupToken: vi.fn(async () => ({ email: 'a@example.com' })),
    setup: vi.fn(async () => undefined),
  };
  const sso = { callback: vi.fn(async () => SESSION) };
  const config = { get: vi.fn((key: string) => values[key]) };
  const controller = new AuthController(authService as never, sso as never, config as never);
  return { controller, authService, sso };
}

function request(headers: Record<string, string> = {}, cookies?: Record<string, string>): Request {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ip: '203.0.113.7',
    headers: lower,
    header: (name: string) => lower[name.toLowerCase()],
    ...(cookies && { cookies }),
  } as unknown as Request;
}

function response() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
    setHeader: vi.fn(),
  };
}

describe('AuthController（docs/architecture/backend/04-auth.md §2、07-testing §8 認證）', () => {
  describe('POST /auth/login', () => {
    it('把 IP 與 User-Agent 交給 service，refresh token 只放進 httpOnly cookie、不出現在回應本文', async () => {
      const { controller, authService } = setup();
      const res = response();
      const dto = { email: 'a@example.com', password: 'pw' };
      const body = await controller.login(
        dto as never,
        request({ 'User-Agent': 'UA/1' }),
        res as unknown as Response,
      );
      expect(authService.login).toHaveBeenCalledWith(dto, { ip: '203.0.113.7', userAgent: 'UA/1' });
      expect(body).toEqual({ accessToken: 'access-1', expiresIn: 900 });
      expect(res.cookie).toHaveBeenCalledWith(COOKIE, 'refresh-raw', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: COOKIE_PATH,
        maxAge: 3_600_000,
      });
    });

    it('production 時 cookie 帶 Secure', async () => {
      const { controller } = setup({ NODE_ENV: 'production' });
      const res = response();
      await controller.login({} as never, request(), res as unknown as Response);
      expect(res.cookie).toHaveBeenCalledWith(
        COOKIE,
        'refresh-raw',
        expect.objectContaining({ secure: true, path: COOKIE_PATH }),
      );
    });
  });

  describe('POST /auth/refresh', () => {
    it('缺少 x-refresh-request 標頭 → AUTH_REFRESH_INVALID，不呼叫 service', async () => {
      const { controller, authService } = setup();
      const res = response();
      await expect(
        controller.refresh(request({}, { [COOKIE]: 'raw' }), res as unknown as Response),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
      expect(authService.refresh).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('x-refresh-request 不是 1 → AUTH_REFRESH_INVALID', async () => {
      const { controller } = setup();
      await expect(
        controller.refresh(
          request({ 'x-refresh-request': 'true' }, { [COOKIE]: 'raw' }),
          response() as unknown as Response,
        ),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    });

    it('沒有任何 cookie → AUTH_REFRESH_INVALID', async () => {
      const { controller, authService } = setup();
      await expect(
        controller.refresh(
          request({ 'x-refresh-request': '1' }),
          response() as unknown as Response,
        ),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('有 cookie 但沒有 refresh cookie → AUTH_REFRESH_INVALID', async () => {
      const { controller } = setup();
      await expect(
        controller.refresh(
          request({ 'x-refresh-request': '1' }, { other: 'x' }),
          response() as unknown as Response,
        ),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    });

    it('標頭與 cookie 都在 → 以 cookie 的原文續期，重設 cookie 並回傳 access token', async () => {
      const { controller, authService } = setup();
      const res = response();
      const body = await controller.refresh(
        request({ 'x-refresh-request': '1', 'user-agent': 'UA/2' }, { [COOKIE]: 'old-raw' }),
        res as unknown as Response,
      );
      expect(authService.refresh).toHaveBeenCalledWith('old-raw', {
        ip: '203.0.113.7',
        userAgent: 'UA/2',
      });
      expect(body).toEqual({ accessToken: 'access-1', expiresIn: 900 });
      expect(res.cookie).toHaveBeenCalledWith(
        COOKIE,
        'refresh-raw',
        expect.objectContaining({ path: COOKIE_PATH, httpOnly: true, maxAge: 3_600_000 }),
      );
    });
  });

  describe('POST /auth/logout', () => {
    it('帶 bearer 與 refresh cookie：都交給 service，清掉 cookie（同一個 Path）並送 Clear-Site-Data', async () => {
      const { controller, authService } = setup();
      const res = response();
      const result = await controller.logout(
        request({ authorization: 'Bearer at-1', 'x-refresh-request': '1' }, { [COOKIE]: 'raw-1' }),
        res as unknown as Response,
      );
      expect(authService.logout).toHaveBeenCalledWith({
        refreshToken: 'raw-1',
        accessToken: 'at-1',
        refreshRequested: true,
      });
      expect(result).toEqual({ endSessionUrl: null });
      expect(res.clearCookie).toHaveBeenCalledWith(COOKIE, { path: COOKIE_PATH });
      expect(res.setHeader).toHaveBeenCalledWith('Clear-Site-Data', CLEAR_SITE_DATA_CACHE);
    });

    it('沒有 bearer、沒有 cookie、沒有標頭：仍清 cookie，service 收到 undefined 與 refreshRequested=false', async () => {
      const { controller, authService } = setup();
      const res = response();
      await controller.logout(request(), res as unknown as Response);
      expect(authService.logout).toHaveBeenCalledWith({
        refreshToken: undefined,
        accessToken: undefined,
        refreshRequested: false,
      });
      expect(res.clearCookie).toHaveBeenCalledWith(COOKIE, { path: COOKIE_PATH });
    });

    it('service 拋錯時不清 cookie', async () => {
      const { controller, authService } = setup();
      authService.logout.mockRejectedValueOnce(new Error('boom'));
      const res = response();
      await expect(controller.logout(request(), res as unknown as Response)).rejects.toThrow(
        'boom',
      );
      expect(res.clearCookie).not.toHaveBeenCalled();
    });
  });

  describe('帳號與個人資料端點', () => {
    it('GET /auth/profile 以目前的使用者查詢', async () => {
      const { controller, authService } = setup();
      await expect(controller.profile(ACTOR)).resolves.toEqual({ id: 'u1' });
      expect(authService.getProfile).toHaveBeenCalledWith(ACTOR);
    });

    it('PATCH /auth/profile 把 DTO 與使用者交給 service', async () => {
      const { controller, authService } = setup();
      const dto = { displayName: 'New' };
      await expect(controller.updateProfile(dto as never, ACTOR)).resolves.toEqual({
        id: 'u1',
        displayName: 'New',
      });
      expect(authService.updateProfile).toHaveBeenCalledWith(dto, ACTOR);
    });

    it('POST /auth/change-password 把 DTO 與使用者交給 service', async () => {
      const { controller, authService } = setup();
      const dto = { currentPassword: 'a', newPassword: 'b' };
      await controller.changePassword(dto as never, ACTOR);
      expect(authService.changePassword).toHaveBeenCalledWith(dto, ACTOR);
    });

    it('POST /auth/register 回傳 service 的結果', async () => {
      const { controller, authService } = setup();
      const dto = { email: 'a@example.com' };
      await expect(controller.register(dto as never)).resolves.toEqual({ submitted: true });
      expect(authService.register).toHaveBeenCalledWith(dto);
    });

    it('POST /auth/forgot-password 回傳 service 的結果', async () => {
      const { controller, authService } = setup();
      const dto = { email: 'a@example.com' };
      await expect(controller.forgotPassword(dto as never)).resolves.toEqual({ sent: true });
      expect(authService.forgotPassword).toHaveBeenCalledWith(dto);
    });

    it('POST /auth/reset-password 把 DTO 交給 service', async () => {
      const { controller, authService } = setup();
      const dto = { token: 't', password: 'p' };
      await controller.resetPassword(dto as never);
      expect(authService.resetPassword).toHaveBeenCalledWith(dto);
    });

    it('GET /auth/setup/verify 以 query 的 token 查詢', async () => {
      const { controller, authService } = setup();
      await expect(controller.verifySetup({ token: 'tok' })).resolves.toEqual({
        email: 'a@example.com',
      });
      expect(authService.verifySetupToken).toHaveBeenCalledWith('tok');
    });

    it('POST /auth/setup 把 DTO 交給 service', async () => {
      const { controller, authService } = setup();
      const dto = { token: 't', password: 'p' };
      await controller.setup(dto as never);
      expect(authService.setup).toHaveBeenCalledWith(dto);
    });
  });

  describe('POST /auth/sso/callback（docs/architecture/04-sso.md §12.2 D3）', () => {
    it('以授權碼換 session：交給 SsoService，設 refresh cookie，回應不含 refresh token', async () => {
      const { controller, sso } = setup();
      const res = response();
      const dto = { code: 'c', codeVerifier: 'v', redirectUri: 'https://app.test/cb' };
      const body = await controller.ssoCallback(
        dto as never,
        request({ 'user-agent': 'UA/3' }),
        res as unknown as Response,
      );
      expect(sso.callback).toHaveBeenCalledWith(dto, { ip: '203.0.113.7', userAgent: 'UA/3' });
      expect(body).not.toHaveProperty('refreshToken');
      expect(body).not.toHaveProperty('refreshTtlSeconds');
      expect(res.cookie).toHaveBeenCalledWith(
        COOKIE,
        'refresh-raw',
        expect.objectContaining({ path: COOKIE_PATH }),
      );
    });
  });
});
