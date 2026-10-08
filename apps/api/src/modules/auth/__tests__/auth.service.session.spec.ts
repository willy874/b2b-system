import { SessionRevokedReason } from '@b2b-system/realtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DomainEvent } from '@/core/events';
import { LoginThrottle, MemoryRateLimitStore } from '@/core/rate-limit';
import { rotateRefreshToken } from '@/modules/credential/refresh-rotation';
import type { RefreshTokenRecord } from '@/modules/credential/refresh-rotation';
import { UserLoginService } from '@/modules/user/user-login.service';

import {
  inTenant,
  makeUser,
  memoryRefreshStore,
  refreshRecord,
  setupAuthService,
  TENANT_ID,
  USER_ID,
} from './auth.fixture';

const meta = { ip: '203.0.113.7', userAgent: 'vitest' };
const credentials = { email: 'alice@example.com', password: 'correct horse battery' };

afterEach(() => {
  vi.useRealTimers();
});

describe('AuthService.login：密碼直接登入（docs/architecture/backend/04-auth.md §3、21-mfa.md §10）', () => {
  it('帳密通過且不需要 MFA → 完成登入並發 session（新家族、access token 帶 tid、不帶 sid）', async () => {
    const ctx = setupAuthService();
    const session = await inTenant(() => ctx.service.login(credentials, meta));

    expect(ctx.logins.completeLogin).toHaveBeenCalledWith(expect.objectContaining({ id: USER_ID }));
    expect(session).toEqual({
      accessToken: 'signed.jwt',
      tokenType: 'Bearer',
      expiresIn: 300,
      refreshToken: 'refresh-raw',
      refreshTtlSeconds: 1_209_600,
    });
    expect(ctx.refreshTokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        clientId: null,
        idpSessionUid: null,
        userAgent: 'vitest',
        ipAddress: '203.0.113.7',
      }),
    );
    const [realm, payload, ttl] = ctx.tokenKeys.sign.mock.calls[0]!;
    expect(realm).toBe('tenant');
    expect(payload).toMatchObject({ sub: USER_ID, ver: 3, tid: TENANT_ID });
    expect(payload).not.toHaveProperty('sid');
    expect(ttl).toBe(300);
  });

  it('需要 MFA 的帳號 → AUTH_MFA_REQUIRED，寫失敗稽核且不完成登入、不發 session', async () => {
    const ctx = setupAuthService();
    ctx.mfa.isRequiredForDirectLogin.mockResolvedValue(true);

    await expect(inTenant(() => ctx.service.login(credentials, meta))).rejects.toMatchObject({
      code: 'AUTH_MFA_REQUIRED',
    });
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.failure',
        errorCode: 'AUTH_MFA_REQUIRED',
        metadata: { reason: 'mfa_required', credentialsValid: true },
      }),
    );
    expect(ctx.logins.completeLogin).not.toHaveBeenCalled();
    expect(ctx.refreshTokens.issue).not.toHaveBeenCalled();
  });

  it('只允許 SSO 的網域 → AUTH_SSO_REQUIRED，先於查帳號（不透露帳號是否存在）', async () => {
    const ctx = setupAuthService();
    ctx.identityProviders.isSsoOnly.mockResolvedValue(true);

    await expect(inTenant(() => ctx.service.checkCredentials(credentials))).rejects.toMatchObject({
      code: 'AUTH_SSO_REQUIRED',
    });
    expect(ctx.logins.verifyPassword).not.toHaveBeenCalled();
  });
});

function withRealLogins() {
  return setupAuthService({
    logins: (deps) =>
      new UserLoginService(
        deps.users as never,
        deps.userCache as never,
        deps.audit as never,
        deps.events as never,
        deps.settings as never,
        deps.passwords as never,
        new LoginThrottle(new MemoryRateLimitStore()),
        {
          isKnown: vi.fn(async () => false),
          remember: vi.fn(async () => undefined),
        } as never,
      ),
  });
}

describe('AuthService.login 經 UserLoginService（docs/architecture/backend/07-testing.md §8 認證）', () => {
  it('帳號不存在與密碼錯誤回應相同（AUTH_INVALID_CREDENTIALS），兩者都跑過一次雜湊比對', async () => {
    const missing = withRealLogins();
    const unknownError = await inTenant(() => missing.service.login(credentials, meta)).catch(
      (error: unknown) => error,
    );
    expect(missing.passwords.verifyAgainstDummy).toHaveBeenCalledTimes(1);

    const wrong = withRealLogins();
    wrong.users.findAccountByEmail.mockResolvedValue(makeUser());
    wrong.passwords.verify.mockResolvedValue(false);
    const wrongError = await inTenant(() => wrong.service.login(credentials, meta)).catch(
      (error: unknown) => error,
    );
    expect(wrong.passwords.verify).toHaveBeenCalledTimes(1);

    expect(unknownError).toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    expect(wrongError).toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    expect((wrongError as Error).message).toBe((unknownError as Error).message);
  });

  it('連續失敗達上限 → 帳號鎖定（auth.account_locked），依租戶設定的次數與時間', async () => {
    const ctx = withRealLogins();
    ctx.users.findAccountByEmail.mockResolvedValue(makeUser());
    ctx.passwords.verify.mockResolvedValue(false);
    ctx.users.recordFailedLogin.mockResolvedValue({ lockedUntil: new Date(Date.now() + 900_000) });

    await expect(inTenant(() => ctx.service.login(credentials, meta))).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    expect(ctx.users.recordFailedLogin).toHaveBeenCalledWith(USER_ID, 5, 900);
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.account_locked' }),
    );
    expect(ctx.refreshTokens.issue).not.toHaveBeenCalled();
  });
});

describe('AuthService.issueSession：經 SSO 的 app session（docs/architecture/04-sso.md §12.2 D4、D5）', () => {
  it('記下產品與 IdP session，access token 帶 sid；沒有 meta 時以 null 記錄', async () => {
    const ctx = setupAuthService();
    await inTenant(() =>
      ctx.service.issueSession(makeUser(), {}, { clientId: 'backstage', idpSessionUid: 'idp-1' }),
    );
    expect(ctx.refreshTokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'backstage',
        idpSessionUid: 'idp-1',
        userAgent: null,
        ipAddress: null,
      }),
    );
    expect(ctx.tokenKeys.sign.mock.calls[0]![1]).toMatchObject({ sid: 'idp-1' });
  });

  it('SSO 來源沒有 IdP session 時 access token 不帶 sid', async () => {
    const ctx = setupAuthService();
    await inTenant(() =>
      ctx.service.issueSession(makeUser(), meta, { clientId: 'backstage', idpSessionUid: null }),
    );
    expect(ctx.tokenKeys.sign.mock.calls[0]![1]).not.toHaveProperty('sid');
  });

  it('沒有租戶脈絡 → TENANT_NOT_FOUND（不退回任何預設租戶）', async () => {
    const ctx = setupAuthService();
    await expect(ctx.service.issueSession(makeUser(), meta)).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
  });
});

function setupRefresh(row: RefreshTokenRecord) {
  const ctx = setupAuthService();
  const { store, revokedFamilies } = memoryRefreshStore([row]);
  ctx.refreshTokens.rotate.mockImplementation((raw: string, options: never) =>
    rotateRefreshToken(store, raw, options),
  );
  ctx.users.findAccountById.mockResolvedValue(makeUser());
  return { ...ctx, store, revokedFamilies };
}

describe('AuthService.refresh：輪替與重用偵測（docs/architecture/backend/04-auth.md §2）', () => {
  it('refresh token 輪替：舊的標成已用、發新的一張，access token 沿用 IdP session 的 sid', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-08T00:00:00Z') });
    const row = refreshRecord();
    const ctx = setupRefresh(row);

    const session = await inTenant(() => ctx.service.refresh('raw-0', meta));

    expect(session.refreshToken).toBe('raw-1');
    expect(session.refreshTtlSeconds).toBe(1_209_600);
    expect(row.usedAt).not.toBeNull();
    expect(ctx.tokenKeys.sign.mock.calls[0]![1]).toMatchObject({ sub: USER_ID, sid: 'idp-1' });
    expect(ctx.refreshTokens.rotate).toHaveBeenCalledWith(
      'raw-0',
      expect.objectContaining({
        ttlSeconds: 1_209_600,
        familyMaxAgeSeconds: 2_592_000,
        reuseGraceSeconds: 10,
        meta,
      }),
    );
  });

  it('refresh token 重用（超過寬限期）→ AUTH_REFRESH_REUSED、整條家族撤銷並寫高嚴重度稽核', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-08T00:00:00Z') });
    const ctx = setupRefresh(refreshRecord({ usedAt: new Date(Date.now() - 60_000) }));

    await expect(inTenant(() => ctx.service.refresh('raw-0', meta))).rejects.toMatchObject({
      code: 'AUTH_REFRESH_REUSED',
    });
    expect(ctx.store.revokeFamily).toHaveBeenCalledWith('family-1', 'reuse_detected');
    expect(ctx.revokedFamilies.has('family-1')).toBe(true);
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.refresh.reuse_detected',
        resourceId: USER_ID,
        errorCode: 'AUTH_REFRESH_REUSED',
        metadata: {
          familyId: 'family-1',
          severity: 'high',
          ip: '203.0.113.7',
          userAgent: 'vitest',
        },
      }),
    );
  });

  it('重用稽核在沒有 meta 時不帶 ip／userAgent', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-08T00:00:00Z') });
    const ctx = setupRefresh(refreshRecord({ usedAt: new Date(Date.now() - 60_000) }));

    await expect(inTenant(() => ctx.service.refresh('raw-0', {}))).rejects.toMatchObject({
      code: 'AUTH_REFRESH_REUSED',
    });
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { familyId: 'family-1', severity: 'high', ip: undefined, userAgent: undefined },
      }),
    );
  });

  it('寬限期內的重送（回應遺失）→ 換發、不撤銷家族，只留一般稽核', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-08T00:00:00Z') });
    const ctx = setupRefresh(refreshRecord({ usedAt: new Date(Date.now() - 2_000) }));

    const session = await inTenant(() => ctx.service.refresh('raw-0', {}));

    expect(session.refreshToken).toBe('raw-superseded');
    expect(ctx.revokedFamilies.size).toBe(0);
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith({
      action: 'auth.refresh.replayed',
      resourceType: 'auth',
      resourceId: USER_ID,
      actorId: USER_ID,
      metadata: { familyId: 'family-1', ip: undefined },
    });
  });

  it.each([
    ['帳號不存在', undefined, 'AUTH_REFRESH_INVALID'],
    ['帳號已刪除', makeUser({ deletedAt: new Date() }), 'AUTH_REFRESH_INVALID'],
    ['帳號已停用', makeUser({ status: 'inactive' }), 'AUTH_ACCOUNT_DISABLED'],
    ['帳號尚未啟用', makeUser({ status: 'pending' }), 'AUTH_ACCOUNT_DISABLED'],
  ] as const)('%s → %s，不發新的 token', async (_label, user, code) => {
    const ctx = setupRefresh(refreshRecord());
    ctx.users.findAccountById.mockResolvedValue(user);

    await expect(inTenant(() => ctx.service.refresh('raw-0', meta))).rejects.toMatchObject({
      code,
    });
    expect(ctx.tokenKeys.sign).not.toHaveBeenCalled();
  });
});

describe('AuthService.logout：有 bearer（docs/architecture/04-sso.md §3.4、§12.2 D5）', () => {
  const actor = { id: USER_ID, email: 'alice@example.com' };

  it('access token 驗證失敗（例：使用者已停用 → AUTH_TOKEN_STALE）→ 原樣拋出，不撤銷任何 token', async () => {
    const ctx = setupAuthService();
    ctx.accessTokens.verify.mockResolvedValue({ ok: false, code: 'AUTH_TOKEN_STALE' });

    await expect(
      ctx.service.logout({ accessToken: 'jwt', refreshToken: 'raw', refreshRequested: false }),
    ).rejects.toMatchObject({ code: 'AUTH_TOKEN_STALE' });
    expect(ctx.refreshTokens.revokeFamilyOf).not.toHaveBeenCalled();
  });

  it('經 SSO 的 session → 撤銷家族並單一登出：銷毀 IdP session、撤銷同 session 的家族、推播 SIGNED_OUT', async () => {
    const ctx = setupAuthService();
    ctx.accessTokens.verify.mockResolvedValue({ ok: true, user: actor });
    ctx.refreshTokens.revokeFamilyOf.mockResolvedValue({
      userId: USER_ID,
      clientId: 'backstage',
      idpSessionUid: 'idp-1',
    });

    await expect(
      ctx.service.logout({ accessToken: 'jwt', refreshToken: 'raw', refreshRequested: false }),
    ).resolves.toEqual({ success: true });
    expect(ctx.refreshTokens.revokeFamilyOf).toHaveBeenCalledWith('raw', 'logout');
    expect(ctx.oidc.destroySession).toHaveBeenCalledWith('idp-1');
    expect(ctx.refreshTokens.revokeByIdpSession).toHaveBeenCalledWith('idp-1', 'sso_logout');
    expect(ctx.events.publish).toHaveBeenCalledWith(DomainEvent.SESSIONS_REVOKED, {
      idpSessionUids: ['idp-1'],
      reason: SessionRevokedReason.SIGNED_OUT,
    });
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.logout',
        actorId: USER_ID,
        metadata: { clientId: 'backstage', singleLogout: true },
      }),
    );
  });

  it('refresh cookie 屬於別人 → 只撤銷那條家族，不結束那個人的 IdP session', async () => {
    const ctx = setupAuthService();
    ctx.accessTokens.verify.mockResolvedValue({ ok: true, user: actor });
    ctx.refreshTokens.revokeFamilyOf.mockResolvedValue({
      userId: 'someone-else',
      clientId: 'backstage',
      idpSessionUid: 'idp-other',
    });

    await ctx.service.logout({ accessToken: 'jwt', refreshToken: 'raw', refreshRequested: false });
    expect(ctx.oidc.destroySession).not.toHaveBeenCalled();
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { clientId: 'backstage', singleLogout: false } }),
    );
  });

  it.each([
    ['沒有 refresh cookie', undefined, undefined],
    ['cookie 找不到 token', 'raw', undefined],
    ['直接登入（沒有 clientId）', 'raw', { userId: USER_ID, clientId: null, idpSessionUid: null }],
  ])('%s → 照樣成功，稽核不帶 metadata', async (_label, refreshToken, row) => {
    const ctx = setupAuthService();
    ctx.accessTokens.verify.mockResolvedValue({ ok: true, user: actor });
    ctx.refreshTokens.revokeFamilyOf.mockResolvedValue(row);

    await expect(
      ctx.service.logout({ accessToken: 'jwt', refreshToken, refreshRequested: false }),
    ).resolves.toEqual({ success: true });
    if (!refreshToken) expect(ctx.refreshTokens.revokeFamilyOf).not.toHaveBeenCalled();
    expect(ctx.oidc.destroySession).not.toHaveBeenCalled();
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.logout', metadata: undefined }),
    );
  });
});

describe('AuthService.logout：沒有 bearer，以 refresh cookie 登出（docs/architecture/04-sso.md §3.4）', () => {
  it.each([
    ['缺少 x-refresh-request（CSRF 緩解）', 'raw', false],
    ['沒有 refresh cookie', undefined, true],
  ])('%s → AUTH_REFRESH_INVALID，不撤銷', async (_label, refreshToken, refreshRequested) => {
    const ctx = setupAuthService();
    await expect(
      ctx.service.logout({ accessToken: undefined, refreshToken, refreshRequested }),
    ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    expect(ctx.refreshTokens.revokeFamilyOf).not.toHaveBeenCalled();
  });

  it('cookie 找不到 token → AUTH_REFRESH_INVALID', async () => {
    const ctx = setupAuthService();
    await expect(
      ctx.service.logout({ accessToken: undefined, refreshToken: 'raw', refreshRequested: true }),
    ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
  });

  it('經 SSO 的家族 → 撤銷家族並結束 IdP session，稽核以 cookie 的主人記錄', async () => {
    const ctx = setupAuthService();
    ctx.refreshTokens.revokeFamilyOf.mockResolvedValue({
      userId: USER_ID,
      clientId: 'backstage',
      idpSessionUid: 'idp-1',
    });
    ctx.users.findAccountById.mockResolvedValue(makeUser());

    await expect(
      ctx.service.logout({ accessToken: undefined, refreshToken: 'raw', refreshRequested: true }),
    ).resolves.toEqual({ success: true });
    expect(ctx.oidc.destroySession).toHaveBeenCalledWith('idp-1');
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: USER_ID,
        actorEmail: 'alice@example.com',
        metadata: { clientId: 'backstage', singleLogout: true, via: 'refreshCookie' },
      }),
    );
  });

  it('直接登入的家族、帳號已不存在 → 只撤銷家族，稽核的 email 記 unknown', async () => {
    const ctx = setupAuthService();
    ctx.refreshTokens.revokeFamilyOf.mockResolvedValue({
      userId: USER_ID,
      clientId: null,
      idpSessionUid: null,
    });

    await ctx.service.logout({
      accessToken: undefined,
      refreshToken: 'raw',
      refreshRequested: true,
    });
    expect(ctx.oidc.destroySession).not.toHaveBeenCalled();
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        actorEmail: 'unknown',
        metadata: { singleLogout: false, via: 'refreshCookie' },
      }),
    );
  });
});
