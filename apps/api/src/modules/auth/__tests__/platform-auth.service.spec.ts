import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runWithRequestContext } from '@/core/http';
import { PLATFORM_ROLE_PERMISSIONS } from '@/db/seeds/platform-permissions';
import { rotateRefreshToken } from '@/modules/credential/refresh-rotation';
import { platformAccountId, tenantAccountId } from '@/modules/oidc-provider/oidc-account';
import type { OidcAccount } from '@/modules/oidc-provider/oidc-account';
import { OidcRedeemError } from '@/modules/oidc-provider/oidc-provider.service';

import { PlatformAuthService } from '../platform-auth.service';
import {
  ADMIN_ID,
  DEFAULT_ENV,
  inTenant,
  memoryRefreshStore,
  refreshRecord,
  TENANT_ID,
  USER_ID,
} from './auth.fixture';

const meta = { ip: '203.0.113.7', userAgent: 'vitest' };
const actor = { id: ADMIN_ID, email: 'ops@example.com' } as never;

function makeAdmin(overrides: Record<string, unknown> = {}) {
  return {
    id: ADMIN_ID,
    email: 'ops@example.com',
    displayName: 'Ops',
    status: 'active',
    role: 'operator',
    tokenVersion: 7,
    lastLoginAt: null as Date | null,
    ...overrides,
  };
}

/** 從 apps/platform 的網域進來的請求。 */
function onPlatformHost<T>(fn: () => T): T {
  return runWithRequestContext({ requestId: 'req-1', platformHost: true }, fn);
}

function setup() {
  let sessionEnded: ((uid: string, account: OidcAccount | undefined) => void) | undefined;
  const config = { get: vi.fn((key: string) => DEFAULT_ENV[key]) };
  const tokenKeys = { sign: vi.fn(async (..._args: unknown[]) => 'platform.jwt') };
  const refreshTokens = {
    issue: vi.fn(async (..._args: unknown[]) => ({ raw: 'refresh-raw' })),
    rotate: vi.fn(),
    revokeFamilyOf: vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined),
    revokeByIdpSession: vi.fn(async (..._args: unknown[]) => undefined),
  };
  const admins = {
    findById: vi.fn(async (_id: string): Promise<unknown> => makeAdmin()),
  };
  const audit = { recordSafely: vi.fn(async (..._args: unknown[]) => undefined) };
  const oidc = {
    onSessionEnded: vi.fn((listener: typeof sessionEnded) => {
      sessionEnded = listener;
    }),
    redeemAuthorizationCode: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({
      accountId: platformAccountId(ADMIN_ID),
      clientId: 'platform',
      sessionUid: 'idp-9',
    })),
    destroySession: vi.fn(async (_uid: string) => undefined),
  };
  const accounts = {
    updateDisplayName: vi.fn(async (..._args: unknown[]) => undefined),
    changePassword: vi.fn(async (..._args: unknown[]) => ({ success: true as const })),
    verifySetupToken: vi.fn(async (_token: string) => ({ valid: true, email: 'ops@example.com' })),
    setup: vi.fn(async (..._args: unknown[]) => ({ success: true as const })),
    resetPassword: vi.fn(async (..._args: unknown[]) => ({ success: true as const })),
  };
  const accessTokens = { verify: vi.fn() };
  const service = new PlatformAuthService(
    config as never,
    tokenKeys as never,
    refreshTokens as never,
    admins as never,
    audit as never,
    oidc as never,
    accounts as never,
    accessTokens as never,
  );
  return {
    service,
    tokenKeys,
    refreshTokens,
    admins,
    audit,
    oidc,
    accounts,
    accessTokens,
    endSession: (uid: string, account: OidcAccount | undefined) => sessionEnded!(uid, account),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PlatformAuthService：只在 apps/platform 的網域（docs/architecture/05-tenancy.md §10.2 D5）', () => {
  const dto = { code: 'c', codeVerifier: 'v', redirectUri: 'r', clientId: 'platform' } as never;
  const calls: [string, (s: PlatformAuthService) => Promise<unknown>][] = [
    ['ssoCallback', (s) => s.ssoCallback(dto, meta)],
    ['refresh', (s) => s.refresh('raw', meta)],
    [
      'logout',
      (s) => s.logout({ accessToken: 'jwt', refreshToken: 'raw', refreshRequested: true }),
    ],
    ['getProfile', (s) => s.getProfile(actor)],
    ['updateProfile', (s) => s.updateProfile({ displayName: 'X' }, actor)],
    ['changePassword', (s) => s.changePassword({ currentPassword: 'a', newPassword: 'b' }, actor)],
    ['verifySetupToken', (s) => s.verifySetupToken('t')],
    ['setup', (s) => s.setup({ token: 't', password: 'p' })],
    ['resetPassword', (s) => s.resetPassword({ token: 't', newPassword: 'p' })],
  ];

  it.each(calls)('%s：不是 apps/platform 的網域 → PLATFORM_ONLY', async (_name, call) => {
    const ctx = setup();
    await expect(call(ctx.service)).rejects.toMatchObject({ code: 'PLATFORM_ONLY' });
  });

  it.each(calls)('%s：租戶網域（有租戶脈絡）→ PLATFORM_ONLY', async (_name, call) => {
    const ctx = setup();
    await expect(onPlatformHost(() => inTenant(() => call(ctx.service)))).rejects.toMatchObject({
      code: 'PLATFORM_ONLY',
    });
  });
});

describe('PlatformAuthService.onModuleInit：provider 的 end-session（docs/architecture/04-sso.md §12.2 D5）', () => {
  it('平台管理者的 IdP session 結束 → 銷毀 session 並撤銷同一個 IdP session 的家族', async () => {
    const ctx = setup();
    ctx.service.onModuleInit();
    ctx.endSession('idp-9', { realm: 'platform', adminId: ADMIN_ID });
    await vi.waitFor(() =>
      expect(ctx.refreshTokens.revokeByIdpSession).toHaveBeenCalledWith('idp-9', 'sso_logout'),
    );
    expect(ctx.oidc.destroySession).toHaveBeenCalledWith('idp-9');
  });

  it.each([
    ['租戶帳號（由 SsoService 處理）', { realm: 'tenant', tenantId: TENANT_ID, userId: USER_ID }],
    ['帳號不明', undefined],
  ] as const)('%s → 略過', (_label, account) => {
    const ctx = setup();
    ctx.service.onModuleInit();
    ctx.endSession('idp-9', account);
    expect(ctx.oidc.destroySession).not.toHaveBeenCalled();
  });

  it('撤銷失敗 → 只記錄警告，不讓 rejection 外漏', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const ctx = setup();
    ctx.oidc.destroySession.mockRejectedValue(new Error('redis down'));
    ctx.service.onModuleInit();
    ctx.endSession('idp-9', { realm: 'platform', adminId: ADMIN_ID });
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });
});

describe('PlatformAuthService.ssoCallback：平台的 BFF（docs/architecture/04-sso.md §12.2 D3、05-tenancy.md §10.2 D10）', () => {
  const dto = {
    code: 'code-1',
    codeVerifier: 'verifier',
    redirectUri: 'https://auth.example.com/sso/callback',
    clientId: 'platform',
  } as never;

  it('兌換成功 → 發平台 session（access token 帶 realm: platform、sid，不帶 tid）並寫稽核', async () => {
    const ctx = setup();
    const session = await onPlatformHost(() => ctx.service.ssoCallback(dto, meta));

    expect(session).toEqual({
      accessToken: 'platform.jwt',
      tokenType: 'Bearer',
      expiresIn: 300,
      refreshToken: 'refresh-raw',
      refreshTtlSeconds: 1_209_600,
    });
    expect(ctx.refreshTokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: ADMIN_ID,
        clientId: 'platform',
        idpSessionUid: 'idp-9',
        userAgent: 'vitest',
        ipAddress: '203.0.113.7',
      }),
    );
    const [realm, payload] = ctx.tokenKeys.sign.mock.calls[0]!;
    expect(realm).toBe('platform');
    expect(payload).toMatchObject({ sub: ADMIN_ID, ver: 7, realm: 'platform', sid: 'idp-9' });
    expect(payload).not.toHaveProperty('tid');
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platformAuth.sso_login',
        actorId: ADMIN_ID,
        metadata: { clientId: 'platform' },
      }),
    );
  });

  it('沒有 IdP session、沒有 meta → 不帶 sid，裝置資訊記 null', async () => {
    const ctx = setup();
    ctx.oidc.redeemAuthorizationCode.mockResolvedValue({
      accountId: platformAccountId(ADMIN_ID),
      clientId: 'platform',
      sessionUid: null,
    });
    await onPlatformHost(() => ctx.service.ssoCallback(dto, {}));
    expect(ctx.tokenKeys.sign.mock.calls[0]![1]).not.toHaveProperty('sid');
    expect(ctx.refreshTokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({ idpSessionUid: null, userAgent: null, ipAddress: null }),
    );
  });

  it('兌換失敗（OidcRedeemError）→ AUTH_SSO_CODE_INVALID，稽核記下原因', async () => {
    const ctx = setup();
    ctx.oidc.redeemAuthorizationCode.mockRejectedValue(new OidcRedeemError('redirect_mismatch'));
    await expect(onPlatformHost(() => ctx.service.ssoCallback(dto, meta))).rejects.toMatchObject({
      code: 'AUTH_SSO_CODE_INVALID',
    });
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platformAuth.sso_login.failure',
        actorEmail: 'anonymous',
        metadata: { clientId: 'platform', reason: 'redirect_mismatch' },
      }),
    );
  });

  it('兌換時的其他錯誤 → 原樣拋出', async () => {
    const ctx = setup();
    const boom = new Error('db down');
    ctx.oidc.redeemAuthorizationCode.mockRejectedValue(boom);
    await expect(onPlatformHost(() => ctx.service.ssoCallback(dto, meta))).rejects.toBe(boom);
    expect(ctx.audit.recordSafely).not.toHaveBeenCalled();
  });

  it.each([
    ['租戶帳號', tenantAccountId(TENANT_ID, USER_ID)],
    ['格式不對的帳號 id', 'legacy'],
  ])('%s的授權碼 → AUTH_SSO_CODE_INVALID（realm_mismatch）', async (_label, accountId) => {
    const ctx = setup();
    ctx.oidc.redeemAuthorizationCode.mockResolvedValue({
      accountId,
      clientId: 'platform',
      sessionUid: 'idp-9',
    });
    await expect(onPlatformHost(() => ctx.service.ssoCallback(dto, meta))).rejects.toMatchObject({
      code: 'AUTH_SSO_CODE_INVALID',
    });
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { clientId: 'platform', reason: 'realm_mismatch' } }),
    );
    expect(ctx.admins.findById).not.toHaveBeenCalled();
  });

  it.each([
    ['管理者已不存在', undefined, 'AUTH_SSO_CODE_INVALID'],
    ['IdP 登入後被停用', makeAdmin({ status: 'inactive' }), 'AUTH_ACCOUNT_DISABLED'],
  ] as const)('%s → %s，不發 session', async (_label, admin, code) => {
    const ctx = setup();
    ctx.admins.findById.mockResolvedValue(admin);
    await expect(onPlatformHost(() => ctx.service.ssoCallback(dto, meta))).rejects.toMatchObject({
      code,
    });
    expect(ctx.refreshTokens.issue).not.toHaveBeenCalled();
  });
});

function setupRefresh(row = refreshRecord({ subjectId: ADMIN_ID })) {
  const ctx = setup();
  const { store, revokedFamilies } = memoryRefreshStore([row]);
  ctx.refreshTokens.rotate.mockImplementation((raw: string, options: never) =>
    rotateRefreshToken(store, raw, options),
  );
  return { ...ctx, row, store, revokedFamilies };
}

describe('PlatformAuthService.refresh：輪替與重用偵測（docs/architecture/backend/04-auth.md §2）', () => {
  it('refresh token 輪替：發新的一張，access token 沿用 sid', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-08T00:00:00Z') });
    const ctx = setupRefresh();
    const session = await onPlatformHost(() => ctx.service.refresh('raw-0', meta));
    expect(session.refreshToken).toBe('raw-1');
    expect(session.refreshTtlSeconds).toBe(1_209_600);
    expect(ctx.row.usedAt).not.toBeNull();
    expect(ctx.tokenKeys.sign.mock.calls[0]![1]).toMatchObject({ sub: ADMIN_ID, sid: 'idp-1' });
  });

  it('refresh token 重用 → AUTH_REFRESH_REUSED、整條家族撤銷並寫高嚴重度稽核', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-08T00:00:00Z') });
    const ctx = setupRefresh(
      refreshRecord({ subjectId: ADMIN_ID, usedAt: new Date(Date.now() - 60_000) }),
    );
    await expect(onPlatformHost(() => ctx.service.refresh('raw-0', meta))).rejects.toMatchObject({
      code: 'AUTH_REFRESH_REUSED',
    });
    expect(ctx.revokedFamilies.has('family-1')).toBe(true);
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith({
      action: 'platformAuth.refresh.reuse_detected',
      resourceType: 'platformAuth',
      resourceId: ADMIN_ID,
      result: 'failure',
      actorId: ADMIN_ID,
      actorEmail: 'unknown',
      errorCode: 'AUTH_REFRESH_REUSED',
      metadata: { familyId: 'family-1', severity: 'high' },
    });
  });

  it.each([
    ['管理者已不存在', undefined, 'AUTH_REFRESH_INVALID'],
    ['管理者已停用', makeAdmin({ status: 'inactive' }), 'AUTH_ACCOUNT_DISABLED'],
  ] as const)('%s → %s', async (_label, admin, code) => {
    const ctx = setupRefresh();
    ctx.admins.findById.mockResolvedValue(admin);
    await expect(onPlatformHost(() => ctx.service.refresh('raw-0', meta))).rejects.toMatchObject({
      code,
    });
    expect(ctx.tokenKeys.sign).not.toHaveBeenCalled();
  });
});

describe('PlatformAuthService.logout（docs/architecture/04-sso.md §3.4、§12.2 D5）', () => {
  it('access token 驗證失敗 → 原樣拋出（例：AUTH_TOKEN_STALE）', async () => {
    const ctx = setup();
    ctx.accessTokens.verify.mockResolvedValue({ ok: false, code: 'AUTH_TOKEN_STALE' });
    await expect(
      onPlatformHost(() =>
        ctx.service.logout({ accessToken: 'jwt', refreshToken: 'raw', refreshRequested: false }),
      ),
    ).rejects.toMatchObject({ code: 'AUTH_TOKEN_STALE' });
    expect(ctx.refreshTokens.revokeFamilyOf).not.toHaveBeenCalled();
  });

  it('自己的 SSO session → 撤銷家族並單一登出', async () => {
    const ctx = setup();
    ctx.accessTokens.verify.mockResolvedValue({ ok: true, user: actor });
    ctx.refreshTokens.revokeFamilyOf.mockResolvedValue({
      adminId: ADMIN_ID,
      idpSessionUid: 'idp-9',
    });

    await expect(
      onPlatformHost(() =>
        ctx.service.logout({ accessToken: 'jwt', refreshToken: 'raw', refreshRequested: false }),
      ),
    ).resolves.toEqual({ success: true });
    expect(ctx.refreshTokens.revokeFamilyOf).toHaveBeenCalledWith('raw', 'logout');
    expect(ctx.oidc.destroySession).toHaveBeenCalledWith('idp-9');
    expect(ctx.refreshTokens.revokeByIdpSession).toHaveBeenCalledWith('idp-9', 'sso_logout');
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'platformAuth.logout', metadata: { singleLogout: true } }),
    );
  });

  it.each([
    ['cookie 屬於別人', 'raw', { adminId: 'other', idpSessionUid: 'idp-x' }],
    ['沒有 refresh cookie', undefined, undefined],
  ])('%s → 不結束 IdP session', async (_label, refreshToken, row) => {
    const ctx = setup();
    ctx.accessTokens.verify.mockResolvedValue({ ok: true, user: actor });
    ctx.refreshTokens.revokeFamilyOf.mockResolvedValue(row);
    await onPlatformHost(() =>
      ctx.service.logout({ accessToken: 'jwt', refreshToken, refreshRequested: false }),
    );
    if (!refreshToken) expect(ctx.refreshTokens.revokeFamilyOf).not.toHaveBeenCalled();
    expect(ctx.oidc.destroySession).not.toHaveBeenCalled();
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { singleLogout: false } }),
    );
  });

  it.each([
    ['缺少 x-refresh-request', 'raw', false],
    ['沒有 refresh cookie', undefined, true],
  ])('沒有 bearer、%s → AUTH_REFRESH_INVALID', async (_label, refreshToken, refreshRequested) => {
    const ctx = setup();
    await expect(
      onPlatformHost(() =>
        ctx.service.logout({ accessToken: undefined, refreshToken, refreshRequested }),
      ),
    ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    expect(ctx.refreshTokens.revokeFamilyOf).not.toHaveBeenCalled();
  });

  it('沒有 bearer、cookie 找不到 token → AUTH_REFRESH_INVALID', async () => {
    const ctx = setup();
    await expect(
      onPlatformHost(() =>
        ctx.service.logout({ accessToken: undefined, refreshToken: 'raw', refreshRequested: true }),
      ),
    ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
  });

  it('沒有 bearer、SSO 的家族 → 撤銷並結束 IdP session，稽核以 cookie 的主人記錄', async () => {
    const ctx = setup();
    ctx.refreshTokens.revokeFamilyOf.mockResolvedValue({
      adminId: ADMIN_ID,
      idpSessionUid: 'idp-9',
    });
    await expect(
      onPlatformHost(() =>
        ctx.service.logout({ accessToken: undefined, refreshToken: 'raw', refreshRequested: true }),
      ),
    ).resolves.toEqual({ success: true });
    expect(ctx.oidc.destroySession).toHaveBeenCalledWith('idp-9');
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        actorEmail: 'ops@example.com',
        metadata: { singleLogout: true, via: 'refreshCookie' },
      }),
    );
  });

  it('沒有 bearer、管理者已不存在 → 稽核的 email 記 unknown', async () => {
    const ctx = setup();
    ctx.refreshTokens.revokeFamilyOf.mockResolvedValue({ adminId: ADMIN_ID, idpSessionUid: null });
    ctx.admins.findById.mockResolvedValue(undefined);
    await onPlatformHost(() =>
      ctx.service.logout({ accessToken: undefined, refreshToken: 'raw', refreshRequested: true }),
    );
    expect(ctx.oidc.destroySession).not.toHaveBeenCalled();
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        actorEmail: 'unknown',
        metadata: { singleLogout: false, via: 'refreshCookie' },
      }),
    );
  });
});

describe('PlatformAuthService 的帳號端點（docs/architecture/05-tenancy.md §10.2 D5）', () => {
  it('getProfile：管理者不存在 → AUTH_TOKEN_INVALID', async () => {
    const ctx = setup();
    ctx.admins.findById.mockResolvedValue(undefined);
    await expect(onPlatformHost(() => ctx.service.getProfile(actor))).rejects.toMatchObject({
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('getProfile：回傳管理者資料與依角色排序後的平台權限', async () => {
    const ctx = setup();
    ctx.admins.findById.mockResolvedValue(
      makeAdmin({ lastLoginAt: new Date('2026-10-01T00:00:00Z') }),
    );
    const profile = await onPlatformHost(() => ctx.service.getProfile(actor));
    expect(profile.admin).toEqual({
      id: ADMIN_ID,
      email: 'ops@example.com',
      displayName: 'Ops',
      status: 'active',
      lastLoginAt: '2026-10-01T00:00:00.000Z',
      role: 'operator',
    });
    expect(profile.permissions).toEqual(PLATFORM_ROLE_PERMISSIONS.operator.toSorted());
  });

  it('updateProfile：更新顯示名稱後回傳最新資料', async () => {
    const ctx = setup();
    const profile = await onPlatformHost(() =>
      ctx.service.updateProfile({ displayName: 'Ops Team' }, actor),
    );
    expect(ctx.accounts.updateDisplayName).toHaveBeenCalledWith(ADMIN_ID, 'Ops Team');
    expect(profile.admin.lastLoginAt).toBeNull();
  });

  it('changePassword / verifySetupToken / setup / resetPassword 交給 PlatformAccountService', async () => {
    const ctx = setup();
    await onPlatformHost(async () => {
      await expect(
        ctx.service.changePassword({ currentPassword: 'old', newPassword: 'new' }, actor),
      ).resolves.toEqual({ success: true });
      await expect(ctx.service.verifySetupToken('tok')).resolves.toEqual({
        valid: true,
        email: 'ops@example.com',
      });
      await expect(ctx.service.setup({ token: 'tok', password: 'pw' })).resolves.toEqual({
        success: true,
      });
      await expect(
        ctx.service.resetPassword({ token: 'tok', newPassword: 'pw2' }),
      ).resolves.toEqual({ success: true });
    });
    expect(ctx.accounts.changePassword).toHaveBeenCalledWith(ADMIN_ID, 'old', 'new');
    expect(ctx.accounts.verifySetupToken).toHaveBeenCalledWith('tok');
    expect(ctx.accounts.setup).toHaveBeenCalledWith('tok', 'pw');
    expect(ctx.accounts.resetPassword).toHaveBeenCalledWith('tok', 'pw2');
  });
});
