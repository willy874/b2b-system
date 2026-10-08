import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';

import { MfaAdminService } from '../mfa-admin.service';
import { ADMIN_ID, USER_ID } from './mfa.fixture';

const ACTOR: AuthUser = { id: 'actor-1', email: 'actor@example.com', status: 'active' };

function setup(superAdmins: string[] = []) {
  const tenantStore = { realm: 'tenant' };
  const mfa = {
    status: vi.fn(async () => ({ enabled: true, factors: [], recoveryCodesRemaining: 3 })),
    reset: vi.fn(async () => ({ success: true as const })),
    requireAccount: vi.fn(async () => ({})),
    store: vi.fn(() => tenantStore),
  };
  const permissions = {
    getPermissionSet: vi.fn(async (id: string) => ({
      permissions: new Set(),
      isSuperAdmin: superAdmins.includes(id),
    })),
  };
  const service = new MfaAdminService(mfa as never, permissions as never);
  return { service, mfa, permissions, tenantStore };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return (error as AppException).code;
}

describe('MfaAdminService（docs/architecture/backend/21-mfa.md §8）', () => {
  it('userStatus／platformAdminStatus 依身分範圍查詢', async () => {
    const { service, mfa } = setup();
    await service.userStatus(USER_ID);
    await service.platformAdminStatus(ADMIN_ID);
    expect(mfa.status).toHaveBeenNthCalledWith(1, 'tenant', USER_ID);
    expect(mfa.status).toHaveBeenNthCalledWith(2, 'platform', ADMIN_ID);
  });

  describe('resetUser', () => {
    it('重設自己 → AUTHZ_SELF_MODIFY', async () => {
      const { service, mfa } = setup();
      expect(await codeOf(service.resetUser(ACTOR, ACTOR.id))).toBe('AUTHZ_SELF_MODIFY');
      expect(mfa.reset).not.toHaveBeenCalled();
    });

    it('對象不存在 → requireAccount 的錯誤', async () => {
      const { service, mfa, tenantStore } = setup();
      mfa.requireAccount.mockRejectedValue(new AppException('USER_NOT_FOUND'));
      expect(await codeOf(service.resetUser(ACTOR, USER_ID))).toBe('USER_NOT_FOUND');
      expect(mfa.requireAccount).toHaveBeenCalledWith(tenantStore, USER_ID);
    });

    it('非 super-admin 重設 super-admin → AUTHZ_ESCALATION（反提權）', async () => {
      const { service, mfa } = setup([USER_ID]);
      const error = await service.resetUser(ACTOR, USER_ID).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe('AUTHZ_ESCALATION');
      expect((error as AppException).details).toEqual({ role: 'super-admin', target: USER_ID });
      expect(mfa.reset).not.toHaveBeenCalled();
    });

    it.each([
      ['super-admin 重設 super-admin', [USER_ID, ACTOR.id]],
      ['重設一般使用者', []],
    ])('%s → 重設', async (_label, superAdmins) => {
      const { service, mfa } = setup(superAdmins);
      expect(await service.resetUser(ACTOR, USER_ID)).toEqual({ success: true });
      expect(mfa.reset).toHaveBeenCalledWith('tenant', ACTOR, USER_ID);
    });
  });

  describe('resetPlatformAdmin', () => {
    it('重設自己 → AUTHZ_SELF_MODIFY', async () => {
      const { service } = setup();
      let error: unknown;
      try {
        await service.resetPlatformAdmin(ACTOR, ACTOR.id);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe('AUTHZ_SELF_MODIFY');
    });

    it('重設其他平台管理者', async () => {
      const { service, mfa } = setup();
      expect(await service.resetPlatformAdmin(ACTOR, ADMIN_ID)).toEqual({ success: true });
      expect(mfa.reset).toHaveBeenCalledWith('platform', ACTOR, ADMIN_ID);
    });
  });
});
