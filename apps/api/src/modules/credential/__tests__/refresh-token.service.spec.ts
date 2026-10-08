import { describe, expect, it, vi } from 'vitest';

import { RefreshTokenService } from '../refresh-token.service';
import { sha256 } from '../token-hash';

function setup(found: { familyId: string } | null = { familyId: 'fam-1' }) {
  const tokenStore = {
    findByHash: vi.fn(async () => undefined),
    isFamilyRevoked: vi.fn(async () => false),
    revokeFamily: vi.fn(async () => undefined),
    rotate: vi.fn(async () => undefined),
    supersede: vi.fn(async () => undefined),
  };
  const repo = {
    store: tokenStore,
    issue: vi.fn(async () => ({ raw: 'raw', row: { id: 'rt-1' } })),
    findByHash: vi.fn(async () => found ?? undefined),
    revokeFamily: vi.fn(async () => undefined),
    revokeAllForUser: vi.fn(async () => undefined),
    revokeByIdpSession: vi.fn(async () => ['u1', 'u2']),
    revokeAll: vi.fn(async () => undefined),
  };
  return { service: new RefreshTokenService(repo as never), repo, tokenStore };
}

describe('RefreshTokenService（docs/architecture/backend/04-auth.md §2）', () => {
  it('issue 把輸入與交易交給 repository', async () => {
    const { service, repo } = setup();
    const input = { userId: 'u1', expiresAt: new Date() } as never;
    const tx = {} as never;
    await expect(service.issue(input, tx)).resolves.toEqual({ raw: 'raw', row: { id: 'rt-1' } });
    expect(repo.issue).toHaveBeenCalledWith(input, tx);
  });

  it('rotate 以 repository 的 store 走共用的輪替規則（找不到 → AUTH_REFRESH_INVALID）', async () => {
    const { service, tokenStore } = setup();
    await expect(
      service.rotate('raw', {
        ttlSeconds: 60,
        familyMaxAgeSeconds: 600,
        reuseGraceSeconds: 0,
        meta: {},
        loadSubject: async () => ({}),
        onReuse: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    expect(tokenStore.findByHash).toHaveBeenCalledWith(sha256('raw'));
  });

  it('revokeFamilyOf：找得到 → 以雜湊查詢並撤銷整條家族，回傳那張 token', async () => {
    const { service, repo } = setup({ familyId: 'fam-9' });
    await expect(service.revokeFamilyOf('raw', 'logout')).resolves.toEqual({ familyId: 'fam-9' });
    expect(repo.findByHash).toHaveBeenCalledWith(sha256('raw'));
    expect(repo.revokeFamily).toHaveBeenCalledWith('fam-9', 'logout');
  });

  it('revokeFamilyOf：找不到 → 回 undefined，不撤銷', async () => {
    const { service, repo } = setup(null);
    await expect(service.revokeFamilyOf('raw', 'logout')).resolves.toBeUndefined();
    expect(repo.revokeFamily).not.toHaveBeenCalled();
  });

  it('revokeAllForUser、revokeByIdpSession、revokeAll 轉交給 repository', async () => {
    const { service, repo } = setup();
    const tx = {} as never;
    await service.revokeAllForUser('u1', 'password_reset', tx);
    expect(repo.revokeAllForUser).toHaveBeenCalledWith('u1', 'password_reset', tx);
    await expect(service.revokeByIdpSession('sid', 'logout')).resolves.toEqual(['u1', 'u2']);
    expect(repo.revokeByIdpSession).toHaveBeenCalledWith('sid', 'logout');
    await service.revokeAll('tenant_disabled');
    expect(repo.revokeAll).toHaveBeenCalledWith('tenant_disabled');
  });
});
