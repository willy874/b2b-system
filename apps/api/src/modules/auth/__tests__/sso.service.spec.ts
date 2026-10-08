import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { tenantAccountId, platformAccountId } from '@/modules/oidc-provider/oidc-account';
import type { OidcAccount } from '@/modules/oidc-provider/oidc-account';
import { OidcRedeemError } from '@/modules/oidc-provider/oidc-provider.service';

import { SsoService } from '../sso.service';
import { ADMIN_ID, inTenant, makeUser, OTHER_TENANT_ID, TENANT_ID, USER_ID } from './auth.fixture';

const req = {} as never;
const res = {} as never;
const credentials = { email: 'alice@example.com', password: 'correct horse battery' };
const meta = { ip: '203.0.113.7' };

const summary = {
  uid: 'int-1',
  prompt: 'login',
  clientId: 'backstage',
  clientName: 'Backstage',
  loginHint: null,
  uiLocales: null,
  tenant: { id: TENANT_ID, code: 'acme', name: 'Acme', extra: 'not exposed' },
};

function setup() {
  let sessionEnded: ((uid: string, account: OidcAccount | undefined) => void) | undefined;
  const auth = {
    endIdpSession: vi.fn(async (_uid: string) => undefined),
    checkCredentials: vi.fn(async (..._args: unknown[]) => makeUser()),
    issueSession: vi.fn(async (..._args: unknown[]) => ({ accessToken: 'jwt' })),
  };
  const oidc = {
    onSessionEnded: vi.fn((listener: typeof sessionEnded) => {
      sessionEnded = listener;
    }),
    interaction: vi.fn(async (..._args: unknown[]): Promise<unknown> => summary),
    finishInteraction: vi.fn(async (..._args: unknown[]) => 'https://auth.example.com/resume'),
    redeemAuthorizationCode: vi.fn(async (..._args: unknown[]): Promise<unknown> => ({
      accountId: tenantAccountId(TENANT_ID, USER_ID),
      clientId: 'backstage',
      sessionUid: 'idp-1',
    })),
  };
  const users = {
    findAccountById: vi.fn(async (_id: string): Promise<unknown> => makeUser()),
  };
  const platformAdmins = {
    verifyPassword: vi.fn(async (..._args: unknown[]) => ({ id: ADMIN_ID })),
  };
  const tenancy = {
    run: vi.fn((_tenantId: string, fn: () => Promise<unknown>) => inTenant(fn)),
  };
  const audit = { recordSafely: vi.fn(async (..._args: unknown[]) => undefined) };
  const mfa = {
    afterPassword: vi.fn(async (..._args: unknown[]) => ({ redirectTo: 'resume' })),
  };
  const service = new SsoService(
    auth as never,
    oidc as never,
    users as never,
    platformAdmins as never,
    tenancy as never,
    audit as never,
    mfa as never,
  );
  return {
    service,
    auth,
    oidc,
    users,
    platformAdmins,
    tenancy,
    audit,
    mfa,
    endSession: (uid: string, account: OidcAccount | undefined) => sessionEnded!(uid, account),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SsoService.onModuleInit：provider 的 end-session（docs/architecture/04-sso.md §12.2 D5）', () => {
  it('租戶帳號的 IdP session 結束 → 在那個租戶裡撤銷同一個 IdP session 的 app session', async () => {
    const ctx = setup();
    ctx.service.onModuleInit();
    ctx.endSession('idp-1', { realm: 'tenant', tenantId: TENANT_ID, userId: USER_ID });

    expect(ctx.tenancy.run).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
    await vi.waitFor(() => expect(ctx.auth.endIdpSession).toHaveBeenCalledWith('idp-1'));
  });

  it.each([
    ['平台管理者（由 PlatformAuthService 處理）', { realm: 'platform', adminId: ADMIN_ID }],
    ['帳號不明', undefined],
  ] as const)('%s → 略過', (_label, account) => {
    const ctx = setup();
    ctx.service.onModuleInit();
    ctx.endSession('idp-1', account);
    expect(ctx.tenancy.run).not.toHaveBeenCalled();
  });

  it('租戶已停用而進不去 → 只記錄警告，不讓 rejection 外漏', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const ctx = setup();
    ctx.tenancy.run.mockRejectedValue(new Error('tenant disabled'));
    ctx.service.onModuleInit();
    ctx.endSession('idp-1', { realm: 'tenant', tenantId: TENANT_ID, userId: USER_ID });

    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_ID }),
        expect.any(String),
      ),
    );
  });
});

describe('SsoService：IdP 的登入互動（docs/architecture/04-sso.md §12、21-mfa.md §4）', () => {
  it('互動不存在或已過期 → AUTH_SSO_INTERACTION_INVALID', async () => {
    const ctx = setup();
    ctx.oidc.interaction.mockResolvedValue(undefined);
    await expect(ctx.service.interaction(req, res, 'int-1')).rejects.toMatchObject({
      code: 'AUTH_SSO_INTERACTION_INVALID',
    });
    await expect(ctx.service.login(req, res, 'int-1', credentials)).rejects.toMatchObject({
      code: 'AUTH_SSO_INTERACTION_INVALID',
    });
  });

  it('互動摘要只對外帶租戶的代碼與名稱', async () => {
    const ctx = setup();
    const dto = await ctx.service.interaction(req, res, 'int-1');
    expect(dto.tenant).toEqual({ code: 'acme', name: 'Acme' });
    expect(dto.clientName).toBe('Backstage');
  });

  it('平台管理者的互動（沒有租戶）→ tenant 為 null', async () => {
    const ctx = setup();
    ctx.oidc.interaction.mockResolvedValue({ ...summary, tenant: null });
    await expect(ctx.service.interaction(req, res, 'int-1')).resolves.toMatchObject({
      tenant: null,
    });
  });

  it('帶租戶的互動 → 在那個租戶驗帳密，通過後交給 MFA 判斷下一步', async () => {
    const ctx = setup();
    await expect(ctx.service.login(req, res, 'int-1', credentials)).resolves.toEqual({
      redirectTo: 'resume',
    });
    expect(ctx.tenancy.run).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
    expect(ctx.auth.checkCredentials).toHaveBeenCalledWith(credentials);
    expect(ctx.mfa.afterPassword).toHaveBeenCalledWith(req, res, 'int-1', 'tenant', USER_ID);
    expect(ctx.platformAdmins.verifyPassword).not.toHaveBeenCalled();
  });

  it('帳密錯誤 → 原樣拋出，不進入 MFA', async () => {
    const ctx = setup();
    ctx.auth.checkCredentials.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'AUTH_INVALID_CREDENTIALS' }),
    );
    await expect(ctx.service.login(req, res, 'int-1', credentials)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    expect(ctx.mfa.afterPassword).not.toHaveBeenCalled();
  });

  it('沒有租戶的互動 → 以平台管理者驗證（docs/architecture/05-tenancy.md §10.2 D8）', async () => {
    const ctx = setup();
    ctx.oidc.interaction.mockResolvedValue({ ...summary, tenant: null });
    await ctx.service.login(req, res, 'int-1', credentials);
    expect(ctx.platformAdmins.verifyPassword).toHaveBeenCalledWith(credentials);
    expect(ctx.mfa.afterPassword).toHaveBeenCalledWith(req, res, 'int-1', 'platform', ADMIN_ID);
    expect(ctx.tenancy.run).not.toHaveBeenCalled();
  });

  it('取消登入 → 以 access_denied 完成互動，回傳 resume 網址', async () => {
    const ctx = setup();
    await expect(ctx.service.abort(req, res, 'int-1')).resolves.toEqual({
      redirectTo: 'https://auth.example.com/resume',
    });
    expect(ctx.oidc.finishInteraction).toHaveBeenCalledWith(req, res, {
      error: 'access_denied',
      error_description: 'login cancelled',
    });
  });

  it('取消已失效的互動 → AUTH_SSO_INTERACTION_INVALID，不完成互動', async () => {
    const ctx = setup();
    ctx.oidc.interaction.mockResolvedValue(undefined);
    await expect(ctx.service.abort(req, res, 'int-1')).rejects.toMatchObject({
      code: 'AUTH_SSO_INTERACTION_INVALID',
    });
    expect(ctx.oidc.finishInteraction).not.toHaveBeenCalled();
  });
});

describe('SsoService.callback：產品的 BFF（docs/architecture/04-sso.md §12.2 D3、05-tenancy.md §10.2 D10）', () => {
  const dto = {
    code: 'code-1',
    codeVerifier: 'verifier',
    redirectUri: 'https://acme.example.com/sso/callback',
    clientId: 'backstage',
  } as never;

  it('兌換成功 → 發 app session（記下產品與 IdP session）並寫 auth.sso_login 稽核', async () => {
    const ctx = setup();
    await expect(inTenant(() => ctx.service.callback(dto, meta))).resolves.toEqual({
      accessToken: 'jwt',
    });
    expect(ctx.users.findAccountById).toHaveBeenCalledWith(USER_ID);
    expect(ctx.auth.issueSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      meta,
      {
        clientId: 'backstage',
        idpSessionUid: 'idp-1',
      },
    );
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.sso_login',
        actorId: USER_ID,
        metadata: { clientId: 'backstage' },
      }),
    );
  });

  it('沒有租戶脈絡 → TENANT_NOT_FOUND，不兌換授權碼', async () => {
    const ctx = setup();
    await expect(ctx.service.callback(dto, meta)).rejects.toMatchObject({
      code: 'TENANT_NOT_FOUND',
    });
    expect(ctx.oidc.redeemAuthorizationCode).not.toHaveBeenCalled();
  });

  it('兌換失敗（OidcRedeemError）→ AUTH_SSO_CODE_INVALID，稽核記下原因', async () => {
    const ctx = setup();
    ctx.oidc.redeemAuthorizationCode.mockRejectedValue(new OidcRedeemError('pkce'));
    await expect(inTenant(() => ctx.service.callback(dto, meta))).rejects.toMatchObject({
      code: 'AUTH_SSO_CODE_INVALID',
    });
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.sso_login.failure',
        errorCode: 'AUTH_SSO_CODE_INVALID',
        metadata: { clientId: 'backstage', reason: 'pkce' },
      }),
    );
  });

  it('兌換時的其他錯誤 → 原樣拋出，不寫失敗稽核', async () => {
    const ctx = setup();
    const boom = new Error('db down');
    ctx.oidc.redeemAuthorizationCode.mockRejectedValue(boom);
    await expect(inTenant(() => ctx.service.callback(dto, meta))).rejects.toBe(boom);
    expect(ctx.audit.recordSafely).not.toHaveBeenCalled();
  });

  it.each([
    ['別的租戶的帳號', tenantAccountId(OTHER_TENANT_ID, USER_ID)],
    ['平台管理者的帳號', platformAccountId(ADMIN_ID)],
    ['格式不對的帳號 id', 'legacy-account'],
  ])('%s → AUTH_SSO_CODE_INVALID（tenant_mismatch），不發 session', async (_label, accountId) => {
    const ctx = setup();
    ctx.oidc.redeemAuthorizationCode.mockResolvedValue({
      accountId,
      clientId: 'backstage',
      sessionUid: 'idp-1',
    });
    await expect(inTenant(() => ctx.service.callback(dto, meta))).rejects.toMatchObject({
      code: 'AUTH_SSO_CODE_INVALID',
    });
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { clientId: 'backstage', reason: 'tenant_mismatch' } }),
    );
    expect(ctx.users.findAccountById).not.toHaveBeenCalled();
    expect(ctx.auth.issueSession).not.toHaveBeenCalled();
  });

  it.each([
    ['帳號已不存在', undefined, 'AUTH_SSO_CODE_INVALID'],
    ['帳號已刪除', makeUser({ deletedAt: new Date() }), 'AUTH_SSO_CODE_INVALID'],
    ['IdP 登入後帳號被停用', makeUser({ status: 'inactive' }), 'AUTH_ACCOUNT_DISABLED'],
  ] as const)('%s → %s，不發 session', async (_label, user, code) => {
    const ctx = setup();
    ctx.users.findAccountById.mockResolvedValue(user);
    await expect(inTenant(() => ctx.service.callback(dto, meta))).rejects.toMatchObject({ code });
    expect(ctx.auth.issueSession).not.toHaveBeenCalled();
  });
});
