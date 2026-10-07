import { describe, expect, it, vi } from 'vitest';

import { LoginThrottle, MemoryRateLimitStore } from '@/core/rate-limit';
import { runInTenantContext } from '@/core/tenant';
import { UserLoginService } from '@/modules/user/user-login.service';

import { AuthService } from '../auth.service';

function setup(
  user: { id: string; status: string; lockedUntil: Date | null } | undefined,
  env: Record<string, unknown> = {},
) {
  const config = { get: vi.fn((key: string) => env[key]) };
  const jobs = { enqueue: vi.fn(async () => undefined) };
  const users = { findAccountByEmail: vi.fn(async () => user) };
  const identityProviders = { isSsoOnly: vi.fn(async () => false) };
  const audit = { recordSafely: vi.fn(async () => undefined) };
  const passwords = { verifyAgainstDummy: vi.fn(async () => false) };
  const logins = new UserLoginService(
    users as never,
    {} as never, // userCache
    audit as never,
    {} as never, // events
    {} as never, // settings
    passwords as never,
    new LoginThrottle(new MemoryRateLimitStore()),
    { isKnown: vi.fn(async () => false), remember: vi.fn(async () => undefined) } as never, // loginSources
  );
  const service = new AuthService(
    {} as never, // db
    config as never,
    {} as never, // tokenKeys
    users as never,
    {} as never, // refreshTokens
    {} as never, // authTokens
    {} as never, // permissionService
    {} as never, // userCache
    audit as never,
    {} as never, // events
    {} as never, // approvals
    jobs as never,
    {} as never, // oidc
    identityProviders as never,
    {} as never, // settings
    {} as never, // flags
    {} as never, // accessTokens
    passwords as never,
    logins,
    {} as never, // mfa
  );
  return { service, jobs, users, identityProviders };
}

describe('AuthService.forgotPassword（docs/architecture/backend/04-auth.md §5.2）', () => {
  it('active（含登入失敗鎖定中）→ 寄重設信；重設會順帶解鎖', async () => {
    const { service, jobs } = setup({
      id: 'u1',
      status: 'active',
      lockedUntil: new Date(Date.now() + 60_000),
    });
    await expect(service.forgotPassword({ email: 'a@example.com' })).resolves.toEqual({
      sent: true,
    });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'auth.passwordResetMail' }),
      { userId: 'u1' },
      expect.anything(),
    );
  });

  it('pending → 改寄啟用信（啟用信過期或寄丟時的自助重寄）', async () => {
    const { service, jobs } = setup({ id: 'u2', status: 'pending', lockedUntil: null });
    await service.forgotPassword({ email: 'b@example.com' });
    expect(jobs.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'auth.activationMail' }),
      { userId: 'u2' },
      expect.anything(),
    );
  });

  it.each([
    ['停用', { id: 'u3', status: 'inactive', lockedUntil: null }],
    ['不存在', undefined],
  ])('%s → 不寄信，回應一樣（帳號列舉防護）', async (_label, user) => {
    const { service, jobs } = setup(user);
    await expect(service.forgotPassword({ email: 'c@example.com' })).resolves.toEqual({
      sent: true,
    });
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});

describe('AuthService.login：直接登入的開關（docs/architecture/06-external-api.md §9.2 D15）', () => {
  const credentials = { email: 'a@example.com', password: 'x' };

  it.each([
    ['production 沒設定 → 關閉', { NODE_ENV: 'production' }],
    ['明確關閉', { NODE_ENV: 'development', DIRECT_LOGIN_ENABLED: false }],
  ])('%s：回 404，不查帳號', async (_label, env) => {
    const { service, users } = setup(undefined, env);
    await expect(service.login(credentials, {} as never)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(users.findAccountByEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['非 production 沒設定 → 開啟', { NODE_ENV: 'test' }],
    ['production 明確開啟', { NODE_ENV: 'production', DIRECT_LOGIN_ENABLED: true }],
  ])('%s：照常驗證帳密', async (_label, env) => {
    const { service, users } = setup(undefined, env);
    await expect(
      runInTenantContext({ id: 't1' } as never, () => service.login(credentials, {} as never)),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    expect(users.findAccountByEmail).toHaveBeenCalled();
  });
});
