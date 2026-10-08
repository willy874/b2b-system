import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { CLEAR_SITE_DATA_CACHE } from '@/core/http';

import type { IssuedSession } from '../auth.service';
import { PlatformAuthController } from '../platform-auth.controller';

const COOKIE = 'b2b_refresh';
const PLATFORM_PATH = '/api/platform/auth';
const ACTOR = { id: 'admin-1' } as AuthUser;

const SESSION = {
  accessToken: 'access-p',
  expiresIn: 600,
  refreshToken: 'refresh-p',
  refreshTtlSeconds: 120,
} as unknown as IssuedSession;

function setup(env: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    REFRESH_COOKIE_NAME: COOKIE,
    // 租戶的 path 不應被平台端用到
    REFRESH_COOKIE_PATH: '/api/auth',
    PLATFORM_REFRESH_COOKIE_PATH: PLATFORM_PATH,
    NODE_ENV: 'test',
    ...env,
  };
  const platformAuth = {
    ssoCallback: vi.fn(async () => SESSION),
    refresh: vi.fn(async () => SESSION),
    logout: vi.fn(async () => ({ endSessionUrl: 'https://idp.test/end' })),
    verifySetupToken: vi.fn(async () => ({ email: 'ops@example.com' })),
    setup: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => undefined),
    getProfile: vi.fn(async () => ({ id: 'admin-1' })),
    updateProfile: vi.fn(async () => ({ id: 'admin-1', displayName: 'Ops' })),
    changePassword: vi.fn(async () => undefined),
  };
  const config = { get: vi.fn((key: string) => values[key]) };
  const controller = new PlatformAuthController(platformAuth as never, config as never);
  return { controller, platformAuth };
}

function request(headers: Record<string, string> = {}, cookies?: Record<string, string>): Request {
  return {
    ip: '198.51.100.1',
    headers,
    header: (name: string) => headers[name.toLowerCase()],
    ...(cookies && { cookies }),
  } as unknown as Request;
}

function response() {
  return { cookie: vi.fn(), clearCookie: vi.fn(), setHeader: vi.fn() };
}

describe('PlatformAuthController（docs/architecture/05-tenancy.md §10.2 D5、07-testing §8 認證）', () => {
  describe('POST /platform/auth/sso/callback', () => {
    it('換到 session 後 cookie 設在 PLATFORM_REFRESH_COOKIE_PATH，回應不含 refresh token', async () => {
      const { controller, platformAuth } = setup();
      const res = response();
      const dto = { code: 'c', codeVerifier: 'v', redirectUri: 'https://platform.test/cb' };
      const body = await controller.ssoCallback(
        dto as never,
        request({ 'user-agent': 'UA' }),
        res as unknown as Response,
      );
      expect(platformAuth.ssoCallback).toHaveBeenCalledWith(dto, {
        ip: '198.51.100.1',
        userAgent: 'UA',
      });
      expect(body).toEqual({ accessToken: 'access-p', expiresIn: 600 });
      expect(res.cookie).toHaveBeenCalledWith(COOKIE, 'refresh-p', {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: PLATFORM_PATH,
        maxAge: 120_000,
      });
    });

    it('production 時 cookie 帶 Secure', async () => {
      const { controller } = setup({ NODE_ENV: 'production' });
      const res = response();
      await controller.ssoCallback({} as never, request(), res as unknown as Response);
      expect(res.cookie).toHaveBeenCalledWith(
        COOKIE,
        'refresh-p',
        expect.objectContaining({ secure: true }),
      );
    });
  });

  describe('POST /platform/auth/refresh', () => {
    it('缺少 x-refresh-request 標頭 → AUTH_REFRESH_INVALID，不呼叫 service', async () => {
      const { controller, platformAuth } = setup();
      await expect(
        controller.refresh(request({}, { [COOKIE]: 'raw' }), response() as unknown as Response),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
      expect(platformAuth.refresh).not.toHaveBeenCalled();
    });

    it('沒有 refresh cookie → AUTH_REFRESH_INVALID', async () => {
      const { controller, platformAuth } = setup();
      await expect(
        controller.refresh(
          request({ 'x-refresh-request': '1' }),
          response() as unknown as Response,
        ),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
      expect(platformAuth.refresh).not.toHaveBeenCalled();
    });

    it('標頭與 cookie 都在 → 續期並重設 cookie', async () => {
      const { controller, platformAuth } = setup();
      const res = response();
      const body = await controller.refresh(
        request({ 'x-refresh-request': '1' }, { [COOKIE]: 'old' }),
        res as unknown as Response,
      );
      expect(platformAuth.refresh).toHaveBeenCalledWith('old', {
        ip: '198.51.100.1',
        userAgent: undefined,
      });
      expect(body).toEqual({ accessToken: 'access-p', expiresIn: 600 });
      expect(res.cookie).toHaveBeenCalledWith(
        COOKIE,
        'refresh-p',
        expect.objectContaining({ path: PLATFORM_PATH }),
      );
    });
  });

  describe('POST /platform/auth/logout', () => {
    it('帶 bearer 與 cookie：交給 service，清平台 path 的 cookie 並送 Clear-Site-Data', async () => {
      const { controller, platformAuth } = setup();
      const res = response();
      const result = await controller.logout(
        request({ authorization: 'Bearer at-p', 'x-refresh-request': '1' }, { [COOKIE]: 'raw' }),
        res as unknown as Response,
      );
      expect(platformAuth.logout).toHaveBeenCalledWith({
        refreshToken: 'raw',
        accessToken: 'at-p',
        refreshRequested: true,
      });
      expect(result).toEqual({ endSessionUrl: 'https://idp.test/end' });
      expect(res.clearCookie).toHaveBeenCalledWith(COOKIE, { path: PLATFORM_PATH });
      expect(res.setHeader).toHaveBeenCalledWith('Clear-Site-Data', CLEAR_SITE_DATA_CACHE);
    });

    it('什麼都沒帶：service 收到 undefined 與 refreshRequested=false，仍清 cookie', async () => {
      const { controller, platformAuth } = setup();
      const res = response();
      await controller.logout(request({ authorization: 'Basic xyz' }), res as unknown as Response);
      expect(platformAuth.logout).toHaveBeenCalledWith({
        refreshToken: undefined,
        accessToken: undefined,
        refreshRequested: false,
      });
      expect(res.clearCookie).toHaveBeenCalledWith(COOKIE, { path: PLATFORM_PATH });
    });
  });

  describe('帳號流程與個人資料', () => {
    it('GET setup/verify 以 query 的 token 查詢', async () => {
      const { controller, platformAuth } = setup();
      await expect(controller.verifySetup({ token: 'tok' })).resolves.toEqual({
        email: 'ops@example.com',
      });
      expect(platformAuth.verifySetupToken).toHaveBeenCalledWith('tok');
    });

    it('POST setup、reset-password 把 DTO 交給 service', async () => {
      const { controller, platformAuth } = setup();
      const dto = { token: 't', password: 'p' };
      await controller.setup(dto as never);
      await controller.resetPassword(dto as never);
      expect(platformAuth.setup).toHaveBeenCalledWith(dto);
      expect(platformAuth.resetPassword).toHaveBeenCalledWith(dto);
    });

    it('GET／PATCH profile 與 change-password 帶目前的平台管理者', async () => {
      const { controller, platformAuth } = setup();
      await expect(controller.profile(ACTOR)).resolves.toEqual({ id: 'admin-1' });
      expect(platformAuth.getProfile).toHaveBeenCalledWith(ACTOR);

      const profileDto = { displayName: 'Ops' };
      await expect(controller.updateProfile(profileDto as never, ACTOR)).resolves.toEqual({
        id: 'admin-1',
        displayName: 'Ops',
      });
      expect(platformAuth.updateProfile).toHaveBeenCalledWith(profileDto, ACTOR);

      const pwDto = { currentPassword: 'a', newPassword: 'b' };
      await controller.changePassword(pwDto as never, ACTOR);
      expect(platformAuth.changePassword).toHaveBeenCalledWith(pwDto, ACTOR);
    });
  });
});
