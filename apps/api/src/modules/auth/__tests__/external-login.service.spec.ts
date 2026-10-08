import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppException } from '@/core/errors';
import type { UserRow } from '@/db/schema';
import { sha256 } from '@/modules/credential/token-hash';
import type { ExternalIdentity } from '@/modules/identity-provider/external-oidc.client';
import { tenantAccountId } from '@/modules/oidc-provider/oidc-account';
import type { ExternalLoginState } from '@/modules/oidc-provider/oidc-provider.service';

import { ExternalLoginService } from '../external-login.service';
import { inTenant, makeUser, TENANT_ID, TX, USER_ID } from './auth.fixture';

const req = {} as never;
const res = {} as never;
const PLATFORM_APP_URL = 'https://auth.example.com';
const CALLBACK_URL = 'https://auth.example.com/api/auth/sso/external/callback';
const API_BASE = 'https://auth.example.com/api';

const interactionSummary = {
  uid: 'int-1',
  prompt: 'login',
  clientId: 'backstage',
  clientName: 'Backstage',
  loginHint: null,
  uiLocales: null,
  tenant: { id: TENANT_ID, code: 'acme', name: 'Acme' },
};

const provider = {
  id: 'idp-1',
  name: 'Corp IdP',
  unmatchedPolicy: 'reject',
  domains: [{ domain: 'example.com' }],
};

const identity: ExternalIdentity = {
  subject: 'ext-sub-1',
  email: 'alice@example.com',
  emailVerified: true,
  name: 'Alice',
};

function setup(env: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    PLATFORM_APP_URL,
    OIDC_ISSUER: 'https://auth.example.com/api/oidc',
    NODE_ENV: 'test',
    ...env,
  };
  const config = { get: vi.fn((key: string) => values[key]) };
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(TX)) };
  const providers = {
    discover: vi.fn(async (_email: string): Promise<unknown> => undefined),
    loginConfig: vi.fn(async (_id: string): Promise<unknown> => ({
      config: { issuer: 'x' },
      provider,
    })),
    callbackUrl: vi.fn(() => CALLBACK_URL),
    findIdentity: vi.fn(
      async (..._args: unknown[]): Promise<{ id: string; userId: string } | undefined> => undefined,
    ),
    touchIdentity: vi.fn(async (_id: string) => undefined),
    unlinkIdentity: vi.fn(async (_id: string) => undefined),
    linkIdentity: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const client = {
    authorizationUrl: vi.fn(async (..._args: unknown[]) => 'https://idp.example.com/authorize'),
    exchange: vi.fn(async (..._args: unknown[]): Promise<ExternalIdentity> => identity),
  };
  const oidc = {
    interaction: vi.fn(async (..._args: unknown[]): Promise<unknown> => interactionSummary),
    saveExternalLogin: vi.fn(async (..._args: unknown[]) => undefined),
    findExternalLogin: vi.fn(
      async (_key: string): Promise<ExternalLoginState | undefined> => undefined,
    ),
    consumeExternalLogin: vi.fn(async (_key: string) => true),
    finishInteraction: vi.fn(async (..._args: unknown[]) => 'https://auth.example.com/resume'),
  };
  const users = {
    findAccountById: vi.fn(async (_id: string): Promise<UserRow | undefined> => undefined),
    findAccountByEmail: vi.fn(async (_email: string): Promise<UserRow | undefined> => undefined),
    updateAccount: vi.fn(async (..._args: unknown[]) => undefined),
    listEffectiveRoles: vi.fn(
      async (_id: string): Promise<{ isSystem: boolean; slug: string }[]> => [],
    ),
    createAccount: vi.fn(async (..._args: unknown[]) => makeUser({ id: 'new-user' })),
    publishCreated: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const audit = {
    record: vi.fn(async (..._args: unknown[]) => undefined),
    recordSafely: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const tenancy = {
    run: vi.fn((_tenantId: string, fn: () => Promise<unknown>) => inTenant(fn)),
  };
  const service = new ExternalLoginService(
    db as never,
    providers as never,
    client as never,
    oidc as never,
    users as never,
    audit as never,
    tenancy as never,
    config as never,
  );
  return { service, db, providers, client, oidc, users, audit, tenancy };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ExternalLoginService.discover：網域導向（docs/architecture/04-sso.md §12.2 D9）', () => {
  it('互動不存在 → AUTH_SSO_INTERACTION_INVALID', async () => {
    const ctx = setup();
    ctx.oidc.interaction.mockResolvedValue(undefined);
    await expect(ctx.service.discover(req, res, 'int-1', 'a@example.com')).rejects.toMatchObject({
      code: 'AUTH_SSO_INTERACTION_INVALID',
    });
  });

  it('平台管理者的互動（沒有租戶）→ 沒有外部 IdP', async () => {
    const ctx = setup();
    ctx.oidc.interaction.mockResolvedValue({ ...interactionSummary, tenant: null });
    await expect(ctx.service.discover(req, res, 'int-1', 'a@example.com')).resolves.toEqual({
      provider: null,
      ssoOnly: false,
    });
    expect(ctx.tenancy.run).not.toHaveBeenCalled();
  });

  it('在互動的租戶裡以 email 查到連線 → 回傳連線與是否只允許 SSO', async () => {
    const ctx = setup();
    ctx.providers.discover.mockResolvedValue({ id: 'idp-1', name: 'Corp IdP', ssoOnly: true });
    await expect(ctx.service.discover(req, res, 'int-1', 'a@example.com')).resolves.toEqual({
      provider: { id: 'idp-1', name: 'Corp IdP' },
      ssoOnly: true,
    });
    expect(ctx.tenancy.run).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
  });

  it('查不到連線 → provider 為 null', async () => {
    const ctx = setup();
    await expect(ctx.service.discover(req, res, 'int-1', 'a@other.com')).resolves.toEqual({
      provider: null,
      ssoOnly: false,
    });
  });
});

describe('ExternalLoginService.start：發起外部登入（docs/architecture/04-sso.md §12.2 D8、RFC 9700 §4.7）', () => {
  it('沒有租戶的互動 → AUTH_SSO_PROVIDER_UNAVAILABLE', async () => {
    const ctx = setup();
    ctx.oidc.interaction.mockResolvedValue({ ...interactionSummary, tenant: null });
    await expect(ctx.service.start(req, res, 'int-1', 'idp-1')).rejects.toMatchObject({
      code: 'AUTH_SSO_PROVIDER_UNAVAILABLE',
    });
  });

  it('連線不存在或已停用 → AUTH_SSO_PROVIDER_UNAVAILABLE', async () => {
    const ctx = setup();
    ctx.providers.loginConfig.mockResolvedValue(undefined);
    await expect(ctx.service.start(req, res, 'int-1', 'idp-1')).rejects.toMatchObject({
      code: 'AUTH_SSO_PROVIDER_UNAVAILABLE',
    });
  });

  it('外部 IdP 的 discovery 失敗 → AUTH_SSO_PROVIDER_UNAVAILABLE 並記警告，不存登入狀態', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const ctx = setup();
    ctx.client.authorizationUrl.mockRejectedValue(new Error('discovery failed'));
    await expect(ctx.service.start(req, res, 'int-1', 'idp-1')).rejects.toMatchObject({
      code: 'AUTH_SSO_PROVIDER_UNAVAILABLE',
    });
    expect(warn).toHaveBeenCalled();
    expect(ctx.oidc.saveExternalLogin).not.toHaveBeenCalled();
  });

  it('回傳授權網址與綁定 cookie；登入狀態記下 PKCE、nonce 與綁定值的雜湊（10 分鐘）', async () => {
    const ctx = setup();
    const result = await ctx.service.start(req, res, 'int-1', 'idp-1');

    expect(result.redirectTo).toBe('https://idp.example.com/authorize');
    const [config, params] = ctx.client.authorizationUrl.mock.calls[0]! as [
      unknown,
      { redirectUri: string; state: string; nonce: string; codeChallenge: string },
    ];
    expect(config).toEqual({ issuer: 'x' });
    expect(params.redirectUri).toBe(CALLBACK_URL);

    const [state, saved, ttl] = ctx.oidc.saveExternalLogin.mock.calls[0]! as [
      string,
      ExternalLoginState,
      number,
    ];
    expect(state).toBe(params.state);
    expect(ttl).toBe(600);
    expect(saved).toMatchObject({
      interactionUid: 'int-1',
      tenantId: TENANT_ID,
      providerId: 'idp-1',
      nonce: params.nonce,
      bindingHash: sha256(result.binding.value),
    });
    expect(createHash('sha256').update(saved.codeVerifier).digest('base64url')).toBe(
      params.codeChallenge,
    );
    expect(result.binding).toEqual({
      name: `ext_login_${sha256(state).slice(0, 16)}`,
      value: expect.any(String),
      options: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/api/auth/sso/external/callback',
        maxAge: 600_000,
      },
    });
  });

  it('production 的綁定 cookie 帶 Secure', async () => {
    const ctx = setup({ NODE_ENV: 'production' });
    const result = await ctx.service.start(req, res, 'int-1', 'idp-1');
    expect(result.binding.options.secure).toBe(true);
  });
});

/** 一筆在 start() 存下的登入狀態，以及這個瀏覽器的綁定 cookie。 */
function pendingLogin(overrides: Partial<ExternalLoginState> = {}) {
  const binding = 'binding-value';
  const state: ExternalLoginState = {
    interactionUid: 'int-1',
    tenantId: TENANT_ID,
    providerId: 'idp-1',
    codeVerifier: 'verifier',
    nonce: 'nonce',
    bindingHash: sha256(binding),
    ...overrides,
  };
  const cookieName = `ext_login_${sha256('state-1').slice(0, 16)}`;
  return { state, cookies: { [cookieName]: binding }, cookieName };
}

const clearCookie = (name: string) => [{ name, path: '/api/auth/sso/external/callback' }];
const interactionError = (code: string) => `${PLATFORM_APP_URL}/interaction/int-1?error=${code}`;

describe('ExternalLoginService.callback：外部 IdP 跳回（docs/architecture/04-sso.md §12.2 D8）', () => {
  it('沒有 state → 跳到錯誤頁，不清 cookie', async () => {
    const ctx = setup();
    await expect(ctx.service.callback({}, '')).resolves.toEqual({
      location: `${PLATFORM_APP_URL}/error?error=AUTH_SSO_EXTERNAL_FAILED`,
      clearCookies: [],
    });
  });

  it('找不到登入狀態（過期或已用）→ 跳到錯誤頁並清掉綁定 cookie', async () => {
    const ctx = setup();
    const { cookieName } = pendingLogin();
    await expect(ctx.service.callback({ state: 'state-1' }, 'state=state-1')).resolves.toEqual({
      location: `${PLATFORM_APP_URL}/error?error=AUTH_SSO_EXTERNAL_FAILED`,
      clearCookies: clearCookie(cookieName),
    });
  });

  it.each([
    ['沒有綁定 cookie（別的瀏覽器）', {}, undefined],
    ['綁定 cookie 不符', 'wrong', undefined],
    ['登入狀態沒有綁定雜湊', undefined, { bindingHash: undefined }],
  ] as const)(
    '%s → browser_mismatch，在兌換授權碼之前拒絕',
    async (_label, cookieValue, overrides) => {
      const ctx = setup();
      const { state, cookies, cookieName } = pendingLogin(overrides);
      ctx.oidc.findExternalLogin.mockResolvedValue(state);
      const jar =
        cookieValue === undefined
          ? cookies
          : typeof cookieValue === 'string'
            ? { [cookieName]: cookieValue }
            : cookieValue;

      const result = await ctx.service.callback({ state: 'state-1' }, 'state=state-1', jar);
      expect(result).toEqual({
        location: interactionError('AUTH_SSO_EXTERNAL_FAILED'),
        clearCookies: clearCookie(cookieName),
      });
      expect(ctx.client.exchange).not.toHaveBeenCalled();
      expect(ctx.oidc.consumeExternalLogin).toHaveBeenCalledWith('state-1');
      expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.login.failure',
          metadata: { method: 'sso', providerId: 'idp-1', reason: 'browser_mismatch' },
        }),
      );
    },
  );

  it('callback 沒帶 cookie 參數 → 視同沒有綁定 cookie', async () => {
    const ctx = setup();
    ctx.oidc.findExternalLogin.mockResolvedValue(pendingLogin().state);
    const result = await ctx.service.callback({ state: 'state-1' }, 'state=state-1');
    expect(result.location).toBe(interactionError('AUTH_SSO_EXTERNAL_FAILED'));
  });

  it('使用者在外部 IdP 取消 → 失敗並記下外部的錯誤', async () => {
    const ctx = setup();
    const { state, cookies } = pendingLogin();
    ctx.oidc.findExternalLogin.mockResolvedValue(state);
    const result = await ctx.service.callback(
      { state: 'state-1', error: 'access_denied' },
      'state=state-1&error=access_denied',
      cookies,
    );
    expect(result.location).toBe(interactionError('AUTH_SSO_EXTERNAL_FAILED'));
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ reason: 'external_error:access_denied' }),
      }),
    );
  });

  it('連線在發起後被停用 → AUTH_SSO_PROVIDER_UNAVAILABLE', async () => {
    const ctx = setup();
    const { state, cookies } = pendingLogin();
    ctx.oidc.findExternalLogin.mockResolvedValue(state);
    ctx.providers.loginConfig.mockResolvedValue(undefined);
    const result = await ctx.service.callback({ state: 'state-1' }, 'state=state-1', cookies);
    expect(result.location).toBe(interactionError('AUTH_SSO_PROVIDER_UNAVAILABLE'));
  });

  it('兌換或 ID token 驗證失敗 → exchange_failed 並記警告', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const ctx = setup();
    const { state, cookies } = pendingLogin();
    ctx.oidc.findExternalLogin.mockResolvedValue(state);
    ctx.client.exchange.mockRejectedValue(new Error('nonce mismatch'));

    const result = await ctx.service.callback({ state: 'state-1' }, '', cookies);
    expect(result.location).toBe(interactionError('AUTH_SSO_EXTERNAL_FAILED'));
    expect(ctx.client.exchange).toHaveBeenCalledWith(
      { issuer: 'x' },
      { currentUrl: CALLBACK_URL, state: 'state-1', nonce: 'nonce', codeVerifier: 'verifier' },
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: 'idp-1' }),
      'exchange_failed',
    );
  });

  it('已連結的身分 → 登入那個帳號：完成登入稽核、換一張與 state 脫鉤的 ticket，跳到互動的 complete', async () => {
    const ctx = setup();
    const { state, cookies, cookieName } = pendingLogin();
    ctx.oidc.findExternalLogin.mockResolvedValue(state);
    ctx.providers.findIdentity.mockResolvedValue({ id: 'link-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(makeUser());

    const result = await ctx.service.callback(
      { state: 'state-1' },
      'code=abc&state=state-1',
      cookies,
    );

    expect(ctx.tenancy.run).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
    expect(ctx.client.exchange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ currentUrl: `${CALLBACK_URL}?code=abc&state=state-1` }),
    );
    expect(ctx.providers.findIdentity).toHaveBeenCalledWith('idp-1', 'ext-sub-1');
    expect(ctx.providers.touchIdentity).toHaveBeenCalledWith('link-1');
    expect(ctx.users.updateAccount).toHaveBeenCalledWith(USER_ID, {
      lastLoginAt: expect.any(Date),
    });
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.success',
        actorId: USER_ID,
        metadata: { method: 'sso', providerId: 'idp-1' },
      }),
    );

    const location = new URL(result.location);
    expect(`${location.origin}${location.pathname}`).toBe(
      `${API_BASE}/oidc-interaction/int-1/external/complete`,
    );
    const ticket = location.searchParams.get('ticket')!;
    expect(ticket).not.toBe('state-1');
    expect(ctx.oidc.saveExternalLogin).toHaveBeenCalledWith(
      sha256(ticket),
      { ...state, accountId: tenantAccountId(TENANT_ID, USER_ID) },
      600,
    );
    expect(ctx.oidc.consumeExternalLogin).toHaveBeenCalledWith('state-1');
    expect(result.clearCookies).toEqual(clearCookie(cookieName));
  });

  it('進不去登入狀態記下的租戶（AppException）→ 跳回互動頁', async () => {
    const ctx = setup();
    const { state, cookies } = pendingLogin();
    ctx.oidc.findExternalLogin.mockResolvedValue(state);
    ctx.tenancy.run.mockRejectedValue(new AppException('TENANT_NOT_FOUND'));
    const result = await ctx.service.callback({ state: 'state-1' }, '', cookies);
    expect(result.location).toBe(interactionError('AUTH_SSO_EXTERNAL_FAILED'));
  });

  it('非預期的錯誤 → 原樣拋出（交給全域錯誤處理）', async () => {
    const ctx = setup();
    const { state, cookies } = pendingLogin();
    ctx.oidc.findExternalLogin.mockResolvedValue(state);
    const boom = new Error('db down');
    ctx.providers.findIdentity.mockRejectedValue(boom);
    await expect(ctx.service.callback({ state: 'state-1' }, '', cookies)).rejects.toBe(boom);
  });
});

function autoCreate(ctx: ReturnType<typeof setup>) {
  ctx.providers.loginConfig.mockResolvedValue({
    config: { issuer: 'x' },
    provider: { ...provider, unmatchedPolicy: 'auto_create' },
  });
}

describe('ExternalLoginService 的帳號對應（docs/architecture/04-sso.md §3.3、§12.2 D8、D10）', () => {
  /** 跑一次 callback，回傳跳轉的錯誤碼（成功時為 null）。 */
  async function resolve(ctx: ReturnType<typeof setup>, id: ExternalIdentity = identity) {
    const { state, cookies } = pendingLogin();
    ctx.oidc.findExternalLogin.mockResolvedValue(state);
    ctx.client.exchange.mockResolvedValue(id);
    const { location } = await ctx.service.callback({ state: 'state-1' }, '', cookies);
    return new URL(location).searchParams.get('error');
  }

  it.each([
    ['已停用', makeUser({ status: 'inactive' }), 'AUTH_ACCOUNT_DISABLED'],
    ['尚未啟用', makeUser({ status: 'pending' }), 'AUTH_ACCOUNT_PENDING'],
    ['已刪除', makeUser({ deletedAt: new Date() }), 'AUTH_SSO_ACCOUNT_NOT_FOUND'],
  ] as const)('已連結的帳號%s → %s', async (_label, user, code) => {
    const ctx = setup();
    ctx.providers.findIdentity.mockResolvedValue({ id: 'link-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(user);
    await expect(resolve(ctx)).resolves.toBe(code);
    expect(ctx.providers.touchIdentity).not.toHaveBeenCalled();
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: code,
        metadata: expect.objectContaining({ reason: 'account_resolution' }),
      }),
    );
  });

  it('登入失敗的自動鎖定不擋外部 IdP（docs/architecture/backend/04-auth.md §3.3）', async () => {
    const ctx = setup();
    ctx.providers.findIdentity.mockResolvedValue({ id: 'link-1', userId: USER_ID });
    ctx.users.findAccountById.mockResolvedValue(
      makeUser({ lockedUntil: new Date(Date.now() + 600_000) }),
    );
    await expect(resolve(ctx)).resolves.toBeNull();
  });

  it('連結指向已刪除的帳號 → 刪掉舊連結，改以 email 對應', async () => {
    const ctx = setup();
    ctx.providers.findIdentity.mockResolvedValue({ id: 'stale-link', userId: 'gone' });
    ctx.users.findAccountByEmail.mockResolvedValue(makeUser());
    await expect(resolve(ctx)).resolves.toBeNull();
    expect(ctx.providers.unlinkIdentity).toHaveBeenCalledWith('stale-link');
    expect(ctx.providers.linkIdentity).toHaveBeenCalled();
  });

  it.each([
    ['沒有 email', { ...identity, email: null }],
    ['email 未驗證', { ...identity, emailVerified: false }],
  ])('%s → AUTH_SSO_ACCOUNT_NOT_FOUND（未驗證的 email 不能拿來對應帳號）', async (_label, id) => {
    const ctx = setup();
    await expect(resolve(ctx, id)).resolves.toBe('AUTH_SSO_ACCOUNT_NOT_FOUND');
    expect(ctx.users.findAccountByEmail).not.toHaveBeenCalled();
  });

  it('已驗證的 email 對上既有帳號、網域屬於這個連線 → 同一交易內連結並寫稽核後登入', async () => {
    const ctx = setup();
    ctx.users.findAccountByEmail.mockResolvedValue(makeUser());
    ctx.users.listEffectiveRoles.mockResolvedValue([
      { isSystem: true, slug: 'member' },
      { isSystem: false, slug: 'editor' },
    ]);

    await expect(resolve(ctx)).resolves.toBeNull();
    expect(ctx.providers.linkIdentity).toHaveBeenCalledWith(
      { userId: USER_ID, providerId: 'idp-1', subject: 'ext-sub-1', email: 'alice@example.com' },
      TX,
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'userIdentity.link',
        resourceId: USER_ID,
        metadata: { providerId: 'idp-1' },
      }),
      TX,
    );
  });

  it('既有帳號已停用 → AUTH_ACCOUNT_DISABLED，不連結', async () => {
    const ctx = setup();
    ctx.users.findAccountByEmail.mockResolvedValue(makeUser({ status: 'inactive' }));
    await expect(resolve(ctx)).resolves.toBe('AUTH_ACCOUNT_DISABLED');
    expect(ctx.providers.linkIdentity).not.toHaveBeenCalled();
  });

  it('既有帳號的 email 網域不屬於這個連線 → AUTH_SSO_LINK_NOT_ALLOWED（自架 IdP 不能接管別人的帳號）', async () => {
    const ctx = setup();
    ctx.users.findAccountByEmail.mockResolvedValue(makeUser({ email: 'bob@victim.com' }));
    await expect(resolve(ctx, { ...identity, email: 'bob@victim.com' })).resolves.toBe(
      'AUTH_SSO_LINK_NOT_ALLOWED',
    );
    expect(ctx.users.listEffectiveRoles).not.toHaveBeenCalled();
    expect(ctx.providers.linkIdentity).not.toHaveBeenCalled();
  });

  it('既有帳號持有 member 以外的系統角色（含經由群組）→ AUTH_SSO_LINK_NOT_ALLOWED', async () => {
    const ctx = setup();
    ctx.users.findAccountByEmail.mockResolvedValue(makeUser());
    ctx.users.listEffectiveRoles.mockResolvedValue([{ isSystem: true, slug: 'admin' }]);
    await expect(resolve(ctx)).resolves.toBe('AUTH_SSO_LINK_NOT_ALLOWED');
    expect(ctx.providers.linkIdentity).not.toHaveBeenCalled();
  });

  it.each([
    ['連線不自動建立帳號', { unmatchedPolicy: 'reject' }, 'alice@example.com'],
    ['email 網域不屬於這個連線', { unmatchedPolicy: 'auto_create' }, 'alice@other.com'],
  ])('沒有對應的帳號、%s → AUTH_SSO_ACCOUNT_NOT_FOUND', async (_label, policy, email) => {
    const ctx = setup();
    ctx.providers.loginConfig.mockResolvedValue({
      config: { issuer: 'x' },
      provider: { ...provider, ...policy },
    });
    await expect(resolve(ctx, { ...identity, email })).resolves.toBe('AUTH_SSO_ACCOUNT_NOT_FOUND');
    expect(ctx.users.createAccount).not.toHaveBeenCalled();
  });

  it('auto_create 且網域屬於連線 → 建立沒有角色的已啟用帳號並連結，交易後推播', async () => {
    const ctx = setup();
    autoCreate(ctx);
    await expect(resolve(ctx, { ...identity, name: '  Alice W  ' })).resolves.toBeNull();
    expect(ctx.users.createAccount).toHaveBeenCalledWith(
      { email: 'alice@example.com', displayName: 'Alice W', status: 'active', roleIds: [] },
      null,
      TX,
      { source: 'identityProvider', providerId: 'idp-1' },
    );
    expect(ctx.providers.linkIdentity).toHaveBeenCalledWith(
      { userId: 'new-user', providerId: 'idp-1', subject: 'ext-sub-1', email: 'alice@example.com' },
      TX,
    );
    expect(ctx.users.publishCreated).toHaveBeenCalledWith('new-user', []);
    expect(ctx.oidc.saveExternalLogin).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ accountId: tenantAccountId(TENANT_ID, 'new-user') }),
      600,
    );
  });

  it.each([
    ['沒有名稱', null],
    ['名稱只有空白', '   '],
  ])('auto_create 時%s → 顯示名稱用 email 的帳號部分', async (_label, name) => {
    const ctx = setup();
    autoCreate(ctx);
    await resolve(ctx, { ...identity, name });
    expect(ctx.users.createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'alice' }),
      null,
      TX,
      expect.anything(),
    );
  });

  it('兩個分頁同時第一次登入（唯一鍵衝突）→ AUTH_SSO_EXTERNAL_FAILED，不推播', async () => {
    const ctx = setup();
    autoCreate(ctx);
    ctx.users.createAccount.mockRejectedValue({ code: '23505' });
    await expect(resolve(ctx)).resolves.toBe('AUTH_SSO_EXTERNAL_FAILED');
    expect(ctx.users.publishCreated).not.toHaveBeenCalled();
  });

  it('建立帳號時的其他錯誤 → 原樣拋出', async () => {
    const ctx = setup();
    autoCreate(ctx);
    const boom = new Error('db down');
    ctx.users.createAccount.mockRejectedValue(boom);
    await expect(resolve(ctx)).rejects.toBe(boom);
  });
});

describe('ExternalLoginService.complete：完成互動（docs/architecture/04-sso.md §12.2 D8）', () => {
  const linked: ExternalLoginState = {
    ...pendingLogin().state,
    accountId: tenantAccountId(TENANT_ID, USER_ID),
  };

  it('以 ticket 完成互動（amr: ext），回傳 resume 網址', async () => {
    const ctx = setup();
    ctx.oidc.findExternalLogin.mockResolvedValue(linked);
    await expect(ctx.service.complete(req, res, 'int-1', 'ticket-1')).resolves.toBe(
      'https://auth.example.com/resume',
    );
    expect(ctx.oidc.findExternalLogin).toHaveBeenCalledWith(sha256('ticket-1'));
    expect(ctx.oidc.consumeExternalLogin).toHaveBeenCalledWith(sha256('ticket-1'));
    expect(ctx.oidc.finishInteraction).toHaveBeenCalledWith(req, res, {
      login: { accountId: linked.accountId, amr: ['ext'] },
    });
  });

  it.each([
    ['ticket 不存在', undefined],
    ['還沒對應到帳號（拿 state 冒充 ticket）', pendingLogin().state],
    ['ticket 屬於別的互動', { ...linked, interactionUid: 'int-other' }],
  ])('%s → AUTH_SSO_EXTERNAL_FAILED', async (_label, pending) => {
    const ctx = setup();
    ctx.oidc.findExternalLogin.mockResolvedValue(pending);
    await expect(ctx.service.complete(req, res, 'int-1', 'ticket-1')).rejects.toMatchObject({
      code: 'AUTH_SSO_EXTERNAL_FAILED',
    });
    expect(ctx.oidc.finishInteraction).not.toHaveBeenCalled();
  });

  it('互動已失效 → AUTH_SSO_INTERACTION_INVALID，不消耗 ticket', async () => {
    const ctx = setup();
    ctx.oidc.findExternalLogin.mockResolvedValue(linked);
    ctx.oidc.interaction.mockResolvedValue(undefined);
    await expect(ctx.service.complete(req, res, 'int-1', 'ticket-1')).rejects.toMatchObject({
      code: 'AUTH_SSO_INTERACTION_INVALID',
    });
    expect(ctx.oidc.consumeExternalLogin).not.toHaveBeenCalled();
  });

  it('ticket 被併發的請求用掉 → AUTH_SSO_EXTERNAL_FAILED', async () => {
    const ctx = setup();
    ctx.oidc.findExternalLogin.mockResolvedValue(linked);
    ctx.oidc.consumeExternalLogin.mockResolvedValue(false);
    await expect(ctx.service.complete(req, res, 'int-1', 'ticket-1')).rejects.toMatchObject({
      code: 'AUTH_SSO_EXTERNAL_FAILED',
    });
    expect(ctx.oidc.finishInteraction).not.toHaveBeenCalled();
  });
});

describe('ExternalLoginService.errorPage', () => {
  it('有互動 → 回到 apps/platform 的互動頁；沒有 → 錯誤頁', () => {
    const ctx = setup();
    expect(ctx.service.errorPage('int-1', 'AUTH_SSO_LINK_NOT_ALLOWED')).toBe(
      `${PLATFORM_APP_URL}/interaction/int-1?error=AUTH_SSO_LINK_NOT_ALLOWED`,
    );
    expect(ctx.service.errorPage(undefined, 'AUTH_SSO_EXTERNAL_FAILED')).toBe(
      `${PLATFORM_APP_URL}/error?error=AUTH_SSO_EXTERNAL_FAILED`,
    );
  });
});
