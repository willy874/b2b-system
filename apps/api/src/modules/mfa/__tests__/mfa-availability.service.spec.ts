import { describe, expect, it, vi } from 'vitest';

import { AppException } from '@/core/errors';
import type { MfaMethod } from '@/core/mfa';

import { DEFAULT_MFA_POLICY, MfaAvailability } from '../mfa-availability.service';
import type { MfaPolicyState } from '../mfa-availability.service';
import { factor, fakeStore, method, registryOf, storedAccount, USER_ID } from './mfa.fixture';

function setup(
  options: {
    platformMethods?: string[];
    platformRequired?: boolean;
    nodeEnv?: string;
    policy?: MfaPolicyState;
    disabled?: string[];
    roles?: string[];
  } = {},
) {
  const totp = method('totp');
  const email = method('email', { realms: ['tenant'] });
  const hardware = method('hardware', { realms: ['platform'] });
  const registry = registryOf(totp, email, hardware);
  const overrides = {
    isEnabled: vi.fn((m: MfaMethod) => !(options.disabled ?? []).includes(m.definition.id)),
  };
  const policies = { find: vi.fn(async () => options.policy) };
  const users = {
    listEffectiveRoles: vi.fn(async () => (options.roles ?? []).map((id) => ({ id }))),
  };
  const env: Record<string, unknown> = {
    PLATFORM_MFA_METHODS: options.platformMethods ?? ['totp'],
    PLATFORM_MFA_REQUIRED: options.platformRequired,
    NODE_ENV: options.nodeEnv ?? 'test',
  };
  const config = { get: vi.fn((key: string) => env[key]) };
  const service = new MfaAvailability(
    registry,
    overrides as never,
    policies as never,
    users as never,
    config as never,
  );
  return { service, overrides, policies, users };
}

const ids = (methods: MfaMethod[]) => methods.map((m) => m.definition.id);

describe('MfaAvailability（docs/architecture/backend/21-mfa.md §4.1、§5、§6）', () => {
  describe('onApplicationBootstrap', () => {
    it('PLATFORM_MFA_METHODS 都是能給平台管理者用的方式 → 通過', () => {
      const { service } = setup({ platformMethods: ['totp', 'hardware'] });
      expect(() => service.onApplicationBootstrap()).not.toThrow();
    });

    it('有不存在或只給租戶用的方式 → 啟動失敗並列出', () => {
      const { service } = setup({ platformMethods: ['totp', 'email', 'sms'] });
      expect(() => service.onApplicationBootstrap()).toThrow('email, sms');
    });
  });

  describe('methodsFor', () => {
    it('平台管理者：註冊表裡能給平台用的 ∩ PLATFORM_MFA_METHODS', async () => {
      const { service, policies } = setup({ platformMethods: ['hardware'] });
      expect(ids(await service.methodsFor('platform'))).toEqual(['hardware']);
      expect(service.platformAdminMethodIds()).toEqual(new Set(['hardware']));
      expect(policies.find).not.toHaveBeenCalled();
    });

    it('租戶：沒有政策時允許平台開放的全部', async () => {
      const { service } = setup({ disabled: ['email'] });
      expect(ids(await service.methodsFor('tenant'))).toEqual(['totp']);
    });

    it('租戶：政策的允許清單再取交集', async () => {
      const { service } = setup({ policy: { ...DEFAULT_MFA_POLICY, allowedMethods: ['email'] } });
      expect(ids(await service.methodsFor('tenant'))).toEqual(['email']);
    });

    it('platformEnabled 只看能給租戶用、平台層開啟的方式', () => {
      const { service, overrides } = setup({ disabled: ['totp'] });
      expect(ids(service.platformEnabled())).toEqual(['email']);
      expect(overrides.isEnabled).toHaveBeenCalledTimes(2);
    });
  });

  describe('isRequired', () => {
    it.each([
      ['PLATFORM_MFA_REQUIRED=true', { platformRequired: true }, true],
      [
        'PLATFORM_MFA_REQUIRED=false（即使在 production）',
        { platformRequired: false, nodeEnv: 'production' },
        false,
      ],
      ['沒設定時 production 預設必須', { nodeEnv: 'production' }, true],
      ['沒設定時非 production 預設不必', { nodeEnv: 'development' }, false],
    ])('平台管理者：%s', async (_label, options, expected) => {
      const { service } = setup(options);
      const { asStore } = fakeStore('platform');
      expect(await service.isRequired(asStore, storedAccount('platform'))).toBe(expected);
    });

    it('租戶：依目前的政策判斷', async () => {
      const { service } = setup({ policy: { ...DEFAULT_MFA_POLICY, requireAll: true } });
      const { asStore } = fakeStore('tenant');
      expect(await service.isRequired(asStore, storedAccount())).toBe(true);
    });
  });

  describe('isRequiredBy', () => {
    it('全員必須 → true，不查角色', async () => {
      const { service, users } = setup();
      expect(await service.isRequiredBy({ requireAll: true, requiredRoleIds: [] }, USER_ID)).toBe(
        true,
      );
      expect(users.listEffectiveRoles).not.toHaveBeenCalled();
    });

    it('沒有指定角色 → false', async () => {
      const { service, users } = setup();
      expect(await service.isRequiredBy({ requireAll: false, requiredRoleIds: [] }, USER_ID)).toBe(
        false,
      );
      expect(users.listEffectiveRoles).not.toHaveBeenCalled();
    });

    it.each([
      ['持有（含經由群組）指定的角色', ['role-x', 'role-a'], true],
      ['沒有指定的角色', ['role-x'], false],
    ])('%s → %s', async (_label, roles, expected) => {
      const { service, users } = setup({ roles });
      expect(
        await service.isRequiredBy({ requireAll: false, requiredRoleIds: ['role-a'] }, USER_ID),
      ).toBe(expected);
      expect(users.listEffectiveRoles).toHaveBeenCalledWith(USER_ID);
    });
  });

  describe('assertCanRemove', () => {
    const required = { policy: { ...DEFAULT_MFA_POLICY, requireAll: true } };

    it('不必啟用的人可以移除最後一個因子', async () => {
      const { service } = setup();
      const { asStore } = fakeStore('tenant');
      await expect(
        service.assertCanRemove(asStore, storedAccount(), factor(), []),
      ).resolves.toBeUndefined();
    });

    it('必須啟用、剩下的因子還有可用的方式 → 可以移除', async () => {
      const { service } = setup(required);
      const { asStore } = fakeStore('tenant');
      await expect(
        service.assertCanRemove(asStore, storedAccount(), factor(), [factor({ method: 'email' })]),
      ).resolves.toBeUndefined();
    });

    it('必須啟用、剩下的因子都不能用 → MFA_LAST_FACTOR', async () => {
      const { service } = setup({ ...required, disabled: ['email'] });
      const { asStore } = fakeStore('tenant');
      const error = await service
        .assertCanRemove(asStore, storedAccount(), factor(), [factor({ method: 'email' })])
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).code).toBe('MFA_LAST_FACTOR');
    });
  });

  it('policy：沒有列時是預設政策', async () => {
    const { service } = setup();
    expect(await service.policy()).toBe(DEFAULT_MFA_POLICY);
  });
});
