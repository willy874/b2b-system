import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AppException } from '@/core/errors';

import { SsoInteractionController } from '../sso-interaction.controller';

const UID = 'uid-123';

function setup() {
  const sso = {
    interaction: vi.fn(async () => ({ clientName: 'Backstage' })),
    login: vi.fn(async () => ({ redirectTo: 'https://idp.test/resume' })),
    abort: vi.fn(async () => ({ redirectTo: 'https://app.test/cb?error=access_denied' })),
  };
  const external = {
    callback: vi.fn(async () => ({
      location: `https://api.test/api/oidc-interaction/${UID}/external/complete?ticket=t`,
      clearCookies: [
        { name: 'ext_binding_a', path: '/api/oidc-interaction/external/callback' },
        { name: 'ext_binding_b', path: '/api/oidc-interaction/external/callback' },
      ],
    })),
    discover: vi.fn(async () => ({ providers: [] })),
    start: vi.fn(async () => ({
      redirectTo: 'https://external-idp.test/authorize?x=1',
      binding: { name: 'ext_binding', value: 'v', options: { httpOnly: true, path: '/x' } },
    })),
    complete: vi.fn(async () => 'https://idp.test/resume/uid-123'),
    errorPage: vi.fn(
      (uid: string, code: string) => `https://platform.test/interaction/${uid}?error=${code}`,
    ),
  };
  const config = {
    get: vi.fn((key: string) => (key === 'PLATFORM_APP_URL' ? 'https://platform.test' : undefined)),
  };
  const controller = new SsoInteractionController(sso as never, external as never, config as never);
  return { controller, sso, external };
}

function response() {
  return { redirect: vi.fn(), clearCookie: vi.fn(), cookie: vi.fn() };
}

const REQ = { ip: '1.2.3.4' } as unknown as Request;

describe('SsoInteractionController（docs/architecture/04-sso.md §12）', () => {
  describe('GET /oidc-interaction/external/callback（§12.2 D8–D10）', () => {
    it('把 query 原文（? 之後）與 cookie 交給 service，清掉綁定 cookie 後 302 到完成網址', async () => {
      const { controller, external } = setup();
      const res = response();
      const cookies = { ext_binding_a: 'v' };
      const query = { state: 's', code: 'c' };
      await controller.externalCallback(
        query as never,
        {
          originalUrl: '/api/oidc-interaction/external/callback?state=s&code=c',
          cookies,
        } as unknown as Request,
        res as unknown as Response,
      );
      expect(external.callback).toHaveBeenCalledWith(query, 'state=s&code=c', cookies);
      expect(res.clearCookie).toHaveBeenNthCalledWith(1, 'ext_binding_a', {
        path: '/api/oidc-interaction/external/callback',
      });
      expect(res.clearCookie).toHaveBeenNthCalledWith(2, 'ext_binding_b', {
        path: '/api/oidc-interaction/external/callback',
      });
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        `https://api.test/api/oidc-interaction/${UID}/external/complete?ticket=t`,
      );
    });

    it('網址沒有 query 時以空字串交給 service，沒有 cookie 時傳 undefined', async () => {
      const { controller, external } = setup();
      await controller.externalCallback(
        {} as never,
        { originalUrl: '/api/oidc-interaction/external/callback' } as unknown as Request,
        response() as unknown as Response,
      );
      expect(external.callback).toHaveBeenCalledWith({}, '', undefined);
    });
  });

  it('GET /oidc-interaction/:uid → 302 到 apps/platform 的互動頁', () => {
    const { controller } = setup();
    const res = response();
    controller.toPage(UID, res as unknown as Response);
    expect(res.redirect).toHaveBeenCalledWith(302, `https://platform.test/interaction/${UID}`);
  });

  it('GET :uid/details 交給 SsoService.interaction', async () => {
    const { controller, sso } = setup();
    const res = response() as unknown as Response;
    await expect(controller.details(UID, REQ, res)).resolves.toEqual({ clientName: 'Backstage' });
    expect(sso.interaction).toHaveBeenCalledWith(REQ, res, UID);
  });

  it('POST :uid/login 把 DTO 交給 SsoService.login 並回傳結果（MFA 的 next 由 service 決定）', async () => {
    const { controller, sso } = setup();
    const res = response() as unknown as Response;
    const dto = { email: 'a@example.com', password: 'pw' };
    await expect(controller.login(UID, dto as never, REQ, res)).resolves.toEqual({
      redirectTo: 'https://idp.test/resume',
    });
    expect(sso.login).toHaveBeenCalledWith(REQ, res, UID, dto);
  });

  it('GET :uid/discover 以 query 的 email 查詢外部 IdP', async () => {
    const { controller, external } = setup();
    const res = response() as unknown as Response;
    await expect(
      controller.discover(UID, { email: 'a@acme.com' } as never, REQ, res),
    ).resolves.toEqual({ providers: [] });
    expect(external.discover).toHaveBeenCalledWith(REQ, res, UID, 'a@acme.com');
  });

  it('POST :uid/external 設綁定 cookie，只回傳外部授權網址', async () => {
    const { controller, external } = setup();
    const res = response();
    const body = await controller.startExternal(
      UID,
      { providerId: 'p1' } as never,
      REQ,
      res as unknown as Response,
    );
    expect(external.start).toHaveBeenCalledWith(REQ, res, UID, 'p1');
    expect(res.cookie).toHaveBeenCalledWith('ext_binding', 'v', { httpOnly: true, path: '/x' });
    expect(body).toEqual({ redirectTo: 'https://external-idp.test/authorize?x=1' });
  });

  describe('GET :uid/external/complete', () => {
    it('成功 → 303 跳回 provider', async () => {
      const { controller, external } = setup();
      const res = response();
      await controller.completeExternal(
        UID,
        { ticket: 't' } as never,
        REQ,
        res as unknown as Response,
      );
      expect(external.complete).toHaveBeenCalledWith(REQ, res, UID, 't');
      expect(res.redirect).toHaveBeenCalledWith(303, 'https://idp.test/resume/uid-123');
    });

    it('AppException → 302 到帶錯誤碼的互動頁', async () => {
      const { controller, external } = setup();
      external.complete.mockRejectedValueOnce(new AppException('AUTH_SSO_INTERACTION_INVALID'));
      const res = response();
      await controller.completeExternal(
        UID,
        { ticket: 't' } as never,
        REQ,
        res as unknown as Response,
      );
      expect(external.errorPage).toHaveBeenCalledWith(UID, 'AUTH_SSO_INTERACTION_INVALID');
      expect(res.redirect).toHaveBeenCalledWith(
        302,
        `https://platform.test/interaction/${UID}?error=AUTH_SSO_INTERACTION_INVALID`,
      );
    });

    it('非 AppException 的錯誤原樣拋出，不跳轉', async () => {
      const { controller, external } = setup();
      external.complete.mockRejectedValueOnce(new Error('db down'));
      const res = response();
      await expect(
        controller.completeExternal(UID, { ticket: 't' } as never, REQ, res as unknown as Response),
      ).rejects.toThrow('db down');
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });

  it('POST :uid/abort 交給 SsoService.abort', async () => {
    const { controller, sso } = setup();
    const res = response() as unknown as Response;
    await expect(controller.abort(UID, REQ, res)).resolves.toEqual({
      redirectTo: 'https://app.test/cb?error=access_denied',
    });
    expect(sso.abort).toHaveBeenCalledWith(REQ, res, UID);
  });
});
