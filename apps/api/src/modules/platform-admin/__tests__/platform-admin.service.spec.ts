import { beforeAll, describe, expect, it, vi } from 'vitest';

import { hashPassword } from '@/modules/credential/password';

import { PlatformAdminService } from '../platform-admin.service';

const PASSWORD = 'Quiet-Harbor-Lantern-26';
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

function setup(admin: { status: string; lockedUntil: Date | null }) {
  const row = { id: 'a1', email: 'ops@example.com', passwordHash, ...admin };
  const repo = {
    findByEmail: vi.fn(async () => row),
    recordFailedLogin: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
  };
  const audit = { recordSafely: vi.fn(async () => undefined) };
  const service = new PlatformAdminService(
    repo as never,
    audit as never,
    {
      get: () => 5,
    } as never,
  );
  return { service, repo, audit };
}

const login = (service: PlatformAdminService, password = PASSWORD) =>
  service.verifyCredentials({ email: 'ops@example.com', password });

describe('PlatformAdminService.verifyCredentials（docs/architecture/backend/04-auth.md §3.2、§3.3）', () => {
  it('鎖定中、密碼正確：與密碼錯誤同樣回 AUTH_INVALID_CREDENTIALS，並留一筆失敗的稽核', async () => {
    const { service, audit, repo } = setup({
      status: 'active',
      lockedUntil: new Date(Date.now() + 60_000),
    });

    await expect(login(service)).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });

    expect(audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platformAuth.login.failure',
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        metadata: { reason: 'locked', credentialsValid: true },
      }),
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', 'AUTH_ACCOUNT_DISABLED', 'disabled'],
    ['pending', 'AUTH_ACCOUNT_PENDING', 'pending'],
  ])('%s、密碼正確：回 %s 並留稽核', async (status, code, reason) => {
    const { service, audit } = setup({ status, lockedUntil: null });

    await expect(login(service)).rejects.toMatchObject({ code });

    expect(audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: code, metadata: { reason, credentialsValid: true } }),
    );
  });

  it('鎖定中、密碼錯誤：不計數、不延長鎖定', async () => {
    const { service, repo } = setup({
      status: 'active',
      lockedUntil: new Date(Date.now() + 60_000),
    });

    await expect(login(service, 'Wrong-Password-2026')).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    expect(repo.recordFailedLogin).not.toHaveBeenCalled();
  });
});
