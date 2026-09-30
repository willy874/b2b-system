import { describe, expect, it, vi } from 'vitest';

import { AuthService } from '../auth.service';

function setup(user: { id: string; status: string; lockedUntil: Date | null } | undefined) {
  const jobs = { enqueue: vi.fn(async () => undefined) };
  const users = { findAccountByEmail: vi.fn(async () => user) };
  const identityProviders = { isSsoOnly: vi.fn(async () => false) };
  const service = new AuthService(
    {} as never, // db
    {} as never, // config
    {} as never, // jwt
    users as never,
    {} as never, // refreshTokens
    {} as never, // authTokens
    {} as never, // permissionService
    {} as never, // userCache
    {} as never, // audit
    {} as never, // events
    {} as never, // approvals
    jobs as never,
    {} as never, // oidc
    identityProviders as never,
    {} as never, // settings
  );
  return { service, jobs, identityProviders };
}

describe('AuthService.forgotPassword（docs/architecture/backend/04-auth.md §5.2）', () => {
  it('active（含登入失敗鎖定中）→ 寄重設信；重設會順帶解鎖（SEC-03）', async () => {
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

  it('pending → 改寄啟用信（啟用信過期或寄丟時的自助重寄，EDGE-14）', async () => {
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
