import type { IncomingMessage, ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { AppException } from '@/core/errors';
import { MFA_RECOVERY_METHOD } from '@/core/mfa';
import type { MfaRealm } from '@/core/mfa';
import { ipPrefixOf } from '@/core/rate-limit';
import type { UserRow } from '@/db/schema';
import type { MfaPending } from '@/modules/oidc-provider/oidc-provider.service';

import type { MfaStoredAccount } from '../mfa-account.store';
import { MfaLoginService } from '../mfa-login.service';
import { MFA_PENDING_MAX_ATTEMPTS, MFA_PENDING_TTL_SECONDS } from '../mfa.constants';
import type { MfaVerifyOutcome } from '../mfa.service';
import {
  ADMIN_ID,
  factor,
  fakeStore,
  method,
  storedAccount,
  TENANT_ID,
  USER_ID,
} from './mfa.fixture';

const req = {} as IncomingMessage;
const res = {} as ServerResponse;
const UID = 'interaction-1';
const IP_PREFIX = ipPrefixOf(undefined);
const TENANT_ACCOUNT = `t:${TENANT_ID}:${USER_ID}`;
const PLATFORM_ACCOUNT = `p:${ADMIN_ID}`;

interface SetupOptions {
  /** 帳號的身分範圍；決定 MfaPending 的 accountId 與互動的租戶。 */
  realm?: MfaRealm;
  stored?: MfaStoredAccount | undefined;
  pending?: Partial<MfaPending> | null;
  interaction?: { tenant: { id: string } | null } | null;
  factors?: ReturnType<typeof factor>[];
  available?: string[];
  recoveryCodes?: number;
  required?: boolean;
}

function setup(options: SetupOptions = {}) {
  const realm = options.realm ?? 'tenant';
  const stored = 'stored' in options ? options.stored : storedAccount(realm);
  const tenant = fakeStore('tenant', realm === 'tenant' ? stored : undefined);
  const platform = fakeStore('platform', realm === 'platform' ? stored : undefined);
  const own = realm === 'tenant' ? tenant : platform;
  own.store.findAccount.mockResolvedValue(stored);
  own.repo.listFactors.mockResolvedValue(options.factors ?? []);
  own.repo.countRecoveryCodes.mockResolvedValue(options.recoveryCodes ?? 0);
  const totp = method('totp');
  const email = method('email', { challenge: 'server' });
  const methods = (options.available ?? ['totp']).map((id) =>
    id === 'email' ? email : id === 'totp' ? totp : method(id),
  );

  const mfa = {
    store: vi.fn((r: MfaRealm) => (r === 'tenant' ? tenant.asStore : platform.asStore)),
    requireAccount: vi.fn(async () => {
      if (!stored) throw new AppException('USER_NOT_FOUND');
      return stored;
    }),
    availableMethods: vi.fn(async () => methods),
    factorDto: vi.fn((f: { id: string; method: string }) => ({ id: f.id, method: f.method })),
    resendChallenge: vi.fn(async () => ({ challengeId: 'challenge-1' })),
    startEnrollment: vi.fn(async () => ({ factorId: 'factor-new' })),
    confirmEnrollment: vi.fn(
      async (): Promise<{ factor: { method: string }; recoveryCodes: string[] | null }> => ({
        factor: { method: 'totp' },
        recoveryCodes: ['AAAA-BBBB'],
      }),
    ),
    verifyRecoveryCode: vi.fn(async () => true),
    afterSecurityChange: vi.fn(async () => undefined),
    requireAvailableMethod: vi.fn(async () => totp),
    verifyFactor: vi.fn(async (): Promise<MfaVerifyOutcome> => ({
      ok: true,
      method: totp,
      counter: 1,
    })),
    amrOf: vi.fn((id: string) => `${id}Amr`),
  };
  const availability = { isRequired: vi.fn(async () => options.required ?? false) };
  const pending: MfaPending | undefined =
    options.pending === null
      ? undefined
      : {
          accountId: realm === 'tenant' ? TENANT_ACCOUNT : PLATFORM_ACCOUNT,
          firstFactor: 'pwd',
          next: 'mfa',
          attempts: 0,
          ...options.pending,
        };
  const interaction =
    options.interaction === null
      ? undefined
      : (options.interaction ?? { tenant: realm === 'tenant' ? { id: TENANT_ID } : null });
  const oidc = {
    finishInteraction: vi.fn(async () => '/resume'),
    saveMfaPending: vi.fn(async () => undefined),
    interaction: vi.fn(async () => interaction),
    findMfaPending: vi.fn(async () => pending),
    incrementMfaPendingAttempts: vi.fn(async (): Promise<number | undefined> => 1),
    destroyMfaPending: vi.fn(async () => undefined),
    consumeMfaPending: vi.fn(async () => true),
  };
  const tenancy = { run: vi.fn((_id: string, fn: () => unknown) => fn()) };
  const loginThrottle = {
    assertAllowed: vi.fn(async () => undefined),
    recordFailure: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
  };
  const service = new MfaLoginService(
    mfa as never,
    availability as never,
    oidc as never,
    tenancy as never,
    loginThrottle as never,
  );
  return { service, mfa, availability, oidc, tenancy, loginThrottle, tenant, platform, own, totp };
}

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('MfaLoginService（docs/architecture/backend/21-mfa.md §4）', () => {
  describe('isRequiredForDirectLogin（§10：直接登入沒有第二步）', () => {
    const user = { id: USER_ID } as UserRow;

    it('找不到帳號（服務帳號之類）→ false', async () => {
      const { service } = setup({ stored: undefined });
      expect(await service.isRequiredForDirectLogin(user)).toBe(false);
    });

    it('不需要第二步 → false', async () => {
      const { service } = setup();
      expect(await service.isRequiredForDirectLogin(user)).toBe(false);
    });

    it('已設定因子 → true（直接登入要拒絕）', async () => {
      const { service } = setup({ factors: [factor()] });
      expect(await service.isRequiredForDirectLogin(user)).toBe(true);
    });
  });

  describe('afterPassword（§4.1）', () => {
    it('不需要第二步：以 amr pwd 完成登入與互動', async () => {
      const { service, own, oidc } = setup();
      const result = await service.afterPassword(req, res, UID, 'tenant', USER_ID);
      expect(result).toEqual({ redirectTo: '/resume' });
      expect(own.store.completeLogin).toHaveBeenCalledWith(expect.anything(), { amr: ['pwd'] });
      expect(oidc.finishInteraction).toHaveBeenCalledWith(req, res, {
        login: { accountId: TENANT_ACCOUNT, amr: ['pwd'] },
      });
      expect(oidc.saveMfaPending).not.toHaveBeenCalled();
    });

    it('無法完成第二步：寫登入失敗的稽核並拋 AUTH_MFA_UNAVAILABLE', async () => {
      const { service, own, oidc } = setup({ required: true, available: [] });
      const error = await rejection(service.afterPassword(req, res, UID, 'tenant', USER_ID));
      expect(error.code).toBe('AUTH_MFA_UNAVAILABLE');
      expect(own.store.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'loginFailure',
          result: 'failure',
          errorCode: 'AUTH_MFA_UNAVAILABLE',
          metadata: { step: 'mfa', reason: 'mfa_unavailable' },
        }),
      );
      expect(oidc.saveMfaPending).not.toHaveBeenCalled();
    });

    it('必須啟用而還沒有因子：存 next = mfaEnroll 的 MfaPending，回傳可設定的方式', async () => {
      const { service, oidc } = setup({ required: true, available: ['totp', 'email'] });
      const result = await service.afterPassword(req, res, UID, 'tenant', USER_ID);
      expect(oidc.saveMfaPending).toHaveBeenCalledWith(
        UID,
        { accountId: TENANT_ACCOUNT, firstFactor: 'pwd', next: 'mfaEnroll', attempts: 0 },
        MFA_PENDING_TTL_SECONDS,
      );
      expect(result).toEqual({
        next: 'mfaEnroll',
        methods: [
          expect.objectContaining({ id: 'totp', challenge: 'none' }),
          expect.objectContaining({ id: 'email', challenge: 'server' }),
        ],
      });
    });

    it('已設定因子：存 next = mfa，只列出可用方式的 active 因子與備用碼是否可用', async () => {
      const { service, oidc, mfa } = setup({
        realm: 'platform',
        factors: [
          factor({ id: 'f-totp' }),
          factor({ id: 'f-email', method: 'email' }),
          factor({ id: 'f-pending', status: 'pending' }),
        ],
        recoveryCodes: 2,
      });
      const result = await service.afterPassword(req, res, UID, 'platform', ADMIN_ID);
      expect(oidc.saveMfaPending).toHaveBeenCalledWith(
        UID,
        expect.objectContaining({ accountId: PLATFORM_ACCOUNT, next: 'mfa' }),
        MFA_PENDING_TTL_SECONDS,
      );
      expect(result).toEqual({
        next: 'mfa',
        factors: [{ id: 'f-totp', method: 'totp' }],
        recoveryAvailable: true,
      });
      expect(mfa.factorDto).toHaveBeenCalledTimes(1);
    });

    it('只剩備用碼可用時 recoveryAvailable 反映剩餘數量', async () => {
      const { service } = setup({ factors: [factor({ method: 'email' })], recoveryCodes: 1 });
      const result = await service.afterPassword(req, res, UID, 'tenant', USER_ID);
      expect(result).toEqual({ next: 'mfa', factors: [], recoveryAvailable: true });
    });
  });

  describe('第二步的前置檢查（withPending）', () => {
    it('互動不存在或 cookie 不符 → AUTH_SSO_INTERACTION_INVALID', async () => {
      const { service } = setup({ interaction: null });
      const error = await rejection(service.verify(req, res, UID, { factorId: 'f', payload: {} }));
      expect(error.code).toBe('AUTH_SSO_INTERACTION_INVALID');
    });

    it.each([
      ['沒有 MfaPending', { pending: null }],
      ['MfaPending 的帳號 id 格式不對', { pending: { accountId: 'garbage' } }],
      ['租戶帳號但互動屬於別的租戶', { interaction: { tenant: { id: 'other-tenant' } } }],
      ['租戶帳號但互動在平台', { interaction: { tenant: null } }],
      [
        '平台帳號但互動屬於租戶',
        { realm: 'platform' as const, interaction: { tenant: { id: TENANT_ID } } },
      ],
      ['MfaPending 的下一步不是這個端點', { pending: { next: 'mfaEnroll' as const } }],
    ])('%s → AUTH_MFA_PENDING_INVALID', async (_label, options: SetupOptions) => {
      const { service, oidc } = setup(options);
      const error = await rejection(service.verify(req, res, UID, { factorId: 'f', payload: {} }));
      expect(error.code).toBe('AUTH_MFA_PENDING_INVALID');
      expect(oidc.destroyMfaPending).not.toHaveBeenCalled();
    });

    it.each([
      ['帳號不存在', undefined],
      ['帳號已停用', storedAccount('tenant', { active: false })],
      ['帳號被鎖定', storedAccount('tenant', { locked: true })],
    ])('%s → 作廢 MfaPending 並拋 AUTH_MFA_PENDING_INVALID', async (_label, stored) => {
      const { service, oidc } = setup({ stored });
      const error = await rejection(service.verify(req, res, UID, { factorId: 'f', payload: {} }));
      expect(error.code).toBe('AUTH_MFA_PENDING_INVALID');
      expect(oidc.destroyMfaPending).toHaveBeenCalledWith(UID);
    });

    it('租戶帳號在 Tenancy.run 的租戶脈絡裡執行', async () => {
      const { service, tenancy, tenant } = setup({ factors: [factor()] });
      tenant.repo.findFactor.mockResolvedValue(factor({ method: 'email' }));
      await service.challenge(req, res, UID, { factorId: 'factor-1' });
      expect(tenancy.run).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
      expect(tenant.store.findAccount).toHaveBeenCalledWith(USER_ID);
    });

    it('平台帳號不進租戶脈絡，以 adminId 找帳號', async () => {
      const { service, tenancy, platform } = setup({ realm: 'platform' });
      platform.repo.findFactor.mockResolvedValue(factor({ method: 'email' }));
      await service.challenge(req, res, UID, { factorId: 'factor-1' });
      expect(tenancy.run).not.toHaveBeenCalled();
      expect(platform.store.findAccount).toHaveBeenCalledWith(ADMIN_ID);
    });
  });

  describe('challenge', () => {
    it('因子不存在 → MFA_FACTOR_NOT_FOUND', async () => {
      const { service } = setup();
      const error = await rejection(service.challenge(req, res, UID, { factorId: 'missing' }));
      expect(error.code).toBe('MFA_FACTOR_NOT_FOUND');
    });

    it('因子還是 pending → MFA_FACTOR_NOT_FOUND', async () => {
      const { service, tenant } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor({ status: 'pending' }));
      const error = await rejection(service.challenge(req, res, UID, { factorId: 'factor-1' }));
      expect(error.code).toBe('MFA_FACTOR_NOT_FOUND');
    });

    it('以登入用途、互動 uid 發出 challenge', async () => {
      const { service, tenant, mfa } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor({ id: 'f-email', method: 'email' }));
      const result = await service.challenge(req, res, UID, { factorId: 'f-email' });
      expect(result).toEqual({ challengeId: 'challenge-1' });
      expect(mfa.resendChallenge).toHaveBeenCalledWith('tenant', USER_ID, 'f-email', 'login', UID);
    });
  });

  describe('verify（§4.2）', () => {
    it('先檢查漸進延遲；被延遲時不驗證', async () => {
      const { service, loginThrottle, mfa } = setup();
      loginThrottle.assertAllowed.mockRejectedValue(new AppException('RATE_LIMITED'));
      const error = await rejection(
        service.verify(req, res, UID, { factorId: 'factor-1', payload: { code: '123456' } }),
      );
      expect(error.code).toBe('RATE_LIMITED');
      expect(loginThrottle.assertAllowed).toHaveBeenCalledWith(
        TENANT_ID,
        'tenant@example.com',
        IP_PREFIX,
      );
      expect(mfa.verifyFactor).not.toHaveBeenCalled();
    });

    it('因子不存在或不是 active → MFA_FACTOR_NOT_FOUND（不計入失敗）', async () => {
      const { service, tenant, loginThrottle } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor({ status: 'pending' }));
      const error = await rejection(
        service.verify(req, res, UID, { factorId: 'factor-1', payload: { code: '1' } }),
      );
      expect(error.code).toBe('MFA_FACTOR_NOT_FOUND');
      expect(loginThrottle.recordFailure).not.toHaveBeenCalled();
    });

    it('方式被關掉的因子 → requireAvailableMethod 的錯誤', async () => {
      const { service, tenant, mfa } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor());
      mfa.requireAvailableMethod.mockRejectedValue(new AppException('MFA_METHOD_DISABLED'));
      const error = await rejection(
        service.verify(req, res, UID, { factorId: 'factor-1', payload: { code: '1' } }),
      );
      expect(error.code).toBe('MFA_METHOD_DISABLED');
    });

    it('驗證成功：消耗 MfaPending、歸零計數，以方式的 amr 完成登入', async () => {
      const { service, tenant, mfa, oidc, loginThrottle } = setup();
      const active = factor();
      tenant.repo.findFactor.mockResolvedValue(active);
      const result = await service.verify(req, res, UID, {
        factorId: 'factor-1',
        challengeId: 'challenge-1',
        payload: { code: '123456' },
      });
      expect(result).toEqual({ redirectTo: '/resume' });
      expect(mfa.verifyFactor).toHaveBeenCalledWith(
        tenant.asStore,
        expect.anything(),
        active,
        'challenge-1',
        { code: '123456' },
        'login',
      );
      expect(oidc.consumeMfaPending).toHaveBeenCalledWith(UID);
      expect(loginThrottle.reset).toHaveBeenCalledWith(TENANT_ID, 'tenant@example.com', IP_PREFIX);
      expect(tenant.store.completeLogin).toHaveBeenCalledWith(expect.anything(), {
        amr: ['pwd', 'mfa', 'totpAmr'],
        mfaMethod: 'totp',
      });
      expect(oidc.finishInteraction).toHaveBeenCalledWith(req, res, {
        login: { accountId: TENANT_ACCOUNT, amr: ['pwd', 'mfa', 'totpAmr'] },
      });
    });

    it('驗證失敗：計入漸進延遲與帳號鎖定，回傳錯誤碼與剩餘次數', async () => {
      const { service, tenant, mfa, oidc, loginThrottle, totp } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor());
      mfa.verifyFactor.mockResolvedValue({
        ok: false,
        reason: 'expired',
        code: 'AUTH_MFA_CHALLENGE_EXPIRED',
      });
      oidc.incrementMfaPendingAttempts.mockResolvedValue(2);
      const error = await rejection(
        service.verify(req, res, UID, { factorId: 'factor-1', payload: { code: '1' } }),
      );
      expect(error.code).toBe('AUTH_MFA_CHALLENGE_EXPIRED');
      expect(error.details).toEqual({ attemptsRemaining: MFA_PENDING_MAX_ATTEMPTS - 2 });
      expect(loginThrottle.recordFailure).toHaveBeenCalledWith(
        TENANT_ID,
        'tenant@example.com',
        IP_PREFIX,
      );
      expect(tenant.store.recordLoginFailure).toHaveBeenCalledWith(expect.anything(), IP_PREFIX, {
        step: 'mfa',
        method: totp.definition.id,
        mfaReason: 'expired',
      });
      expect(oidc.destroyMfaPending).not.toHaveBeenCalled();
      expect(oidc.consumeMfaPending).not.toHaveBeenCalled();
    });

    it.each([
      ['達到上限', MFA_PENDING_MAX_ATTEMPTS],
      ['MfaPending 已不存在（計數回 undefined）', undefined],
    ])('失敗次數%s → 作廢 MfaPending 並拋 AUTH_MFA_TOO_MANY_ATTEMPTS', async (_label, attempts) => {
      const { service, tenant, mfa, oidc } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor());
      mfa.verifyFactor.mockResolvedValue({
        ok: false,
        reason: 'invalid',
        code: 'AUTH_MFA_INVALID_CODE',
      });
      oidc.incrementMfaPendingAttempts.mockResolvedValue(attempts);
      const error = await rejection(
        service.verify(req, res, UID, { factorId: 'factor-1', payload: { code: '1' } }),
      );
      expect(error.code).toBe('AUTH_MFA_TOO_MANY_ATTEMPTS');
      expect(oidc.destroyMfaPending).toHaveBeenCalledWith(UID);
    });

    it('併發的另一次驗證已消耗 MfaPending → AUTH_MFA_PENDING_INVALID，不完成登入', async () => {
      const { service, tenant, oidc, loginThrottle } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor());
      oidc.consumeMfaPending.mockResolvedValue(false);
      const error = await rejection(
        service.verify(req, res, UID, { factorId: 'factor-1', payload: { code: '1' } }),
      );
      expect(error.code).toBe('AUTH_MFA_PENDING_INVALID');
      expect(loginThrottle.reset).not.toHaveBeenCalled();
      expect(tenant.store.completeLogin).not.toHaveBeenCalled();
    });

    describe('備用碼', () => {
      it('成功：寫稽核與安全通知，amr 為 mfa', async () => {
        const { service, tenant, mfa } = setup();
        tenant.repo.countRecoveryCodes.mockResolvedValue(7);
        const result = await service.verify(req, res, UID, {
          factorId: MFA_RECOVERY_METHOD,
          payload: { code: 'ABCD-EFGH' },
        });
        expect(result).toEqual({ redirectTo: '/resume' });
        expect(mfa.verifyRecoveryCode).toHaveBeenCalledWith(tenant.asStore, USER_ID, {
          code: 'ABCD-EFGH',
        });
        expect(tenant.store.audit).toHaveBeenCalledWith({
          kind: 'recoveryUse',
          target: expect.objectContaining({ id: USER_ID }),
          metadata: { remaining: 7, interactionUid: UID },
        });
        expect(mfa.afterSecurityChange).toHaveBeenCalledWith(
          tenant.asStore,
          expect.objectContaining({ id: USER_ID }),
          'recoveryCodeUsed',
          tenant.tx,
        );
        expect(tenant.store.completeLogin).toHaveBeenCalledWith(expect.anything(), {
          amr: ['pwd', 'mfa', 'mfa'],
          mfaMethod: MFA_RECOVERY_METHOD,
        });
      });

      it('碼不對 → AUTH_MFA_INVALID_CODE，以 recovery 記下失敗', async () => {
        const { service, tenant, mfa } = setup();
        mfa.verifyRecoveryCode.mockResolvedValue(false);
        const error = await rejection(
          service.verify(req, res, UID, {
            factorId: MFA_RECOVERY_METHOD,
            payload: { code: 'WRONG' },
          }),
        );
        expect(error.code).toBe('AUTH_MFA_INVALID_CODE');
        expect(tenant.store.recordLoginFailure).toHaveBeenCalledWith(expect.anything(), IP_PREFIX, {
          step: 'mfa',
          method: MFA_RECOVERY_METHOD,
          mfaReason: 'invalid',
        });
        expect(tenant.store.audit).not.toHaveBeenCalled();
      });

      it('payload 格式不對 → 不呼叫驗證，直接當作碼不對', async () => {
        const { service, mfa } = setup();
        const error = await rejection(
          service.verify(req, res, UID, { factorId: MFA_RECOVERY_METHOD, payload: { code: '' } }),
        );
        expect(error.code).toBe('AUTH_MFA_INVALID_CODE');
        expect(mfa.verifyRecoveryCode).not.toHaveBeenCalled();
      });
    });
  });

  describe('互動中的首次設定（§4.1 第 2 步）', () => {
    const enrollPending = { pending: { next: 'mfaEnroll' as const } };

    it('startEnrollment 以互動 uid 開始設定', async () => {
      const { service, mfa } = setup(enrollPending);
      expect(await service.startEnrollment(req, res, UID, 'totp')).toEqual({
        factorId: 'factor-new',
      });
      expect(mfa.startEnrollment).toHaveBeenCalledWith('tenant', USER_ID, 'totp', UID);
    });

    it('startEnrollment 在 next = mfa 的互動 → AUTH_MFA_PENDING_INVALID', async () => {
      const { service } = setup();
      const error = await rejection(service.startEnrollment(req, res, UID, 'totp'));
      expect(error.code).toBe('AUTH_MFA_PENDING_INVALID');
    });

    it('resendEnrollment 以設定用途重寄', async () => {
      const { service, mfa } = setup(enrollPending);
      await service.resendEnrollment(req, res, UID, 'factor-new');
      expect(mfa.resendChallenge).toHaveBeenCalledWith(
        'tenant',
        USER_ID,
        'factor-new',
        'enroll',
        UID,
      );
    });

    describe('confirmEnrollment', () => {
      const dto = { challengeId: undefined, payload: { code: '123456' } };

      it('成功：回傳備用碼，以方式的 amr 完成登入與互動', async () => {
        const { service, mfa, oidc, tenant, loginThrottle } = setup(enrollPending);
        const result = await service.confirmEnrollment(req, res, UID, 'factor-new', dto);
        expect(result).toEqual({ recoveryCodes: ['AAAA-BBBB'], redirectTo: '/resume' });
        expect(mfa.confirmEnrollment).toHaveBeenCalledWith('tenant', USER_ID, 'factor-new', dto, {
          interactionUid: UID,
        });
        expect(oidc.consumeMfaPending).toHaveBeenCalledWith(UID);
        expect(loginThrottle.reset).toHaveBeenCalled();
        expect(tenant.store.completeLogin).toHaveBeenCalledWith(expect.anything(), {
          amr: ['pwd', 'mfa', 'totpAmr'],
          mfaMethod: 'totp',
        });
      });

      it('沒有產生備用碼（不是第一個因子）時回傳空陣列', async () => {
        const { service, mfa } = setup(enrollPending);
        mfa.confirmEnrollment.mockResolvedValue({
          factor: { method: 'totp' },
          recoveryCodes: null,
        });
        const result = await service.confirmEnrollment(req, res, UID, 'factor-new', dto);
        expect(result.recoveryCodes).toEqual([]);
      });

      it.each(['AUTH_MFA_INVALID_CODE', 'AUTH_MFA_CHALLENGE_EXPIRED'] as const)(
        '%s：計入失敗後原樣拋出',
        async (code) => {
          const { service, mfa, tenant, loginThrottle, oidc } = setup(enrollPending);
          mfa.confirmEnrollment.mockRejectedValue(new AppException(code));
          oidc.incrementMfaPendingAttempts.mockResolvedValue(1);
          const error = await rejection(
            service.confirmEnrollment(req, res, UID, 'factor-new', dto),
          );
          expect(error.code).toBe(code);
          expect(loginThrottle.recordFailure).toHaveBeenCalled();
          expect(tenant.store.recordLoginFailure).toHaveBeenCalledWith(
            expect.anything(),
            IP_PREFIX,
            { step: 'mfaEnroll', mfaReason: code },
          );
          expect(oidc.destroyMfaPending).not.toHaveBeenCalled();
        },
      );

      it.each([
        ['達到上限', MFA_PENDING_MAX_ATTEMPTS],
        ['MfaPending 已不存在', undefined],
      ])('碼錯且失敗次數%s → AUTH_MFA_TOO_MANY_ATTEMPTS', async (_label, attempts) => {
        const { service, mfa, oidc } = setup(enrollPending);
        mfa.confirmEnrollment.mockRejectedValue(new AppException('AUTH_MFA_INVALID_CODE'));
        oidc.incrementMfaPendingAttempts.mockResolvedValue(attempts);
        const error = await rejection(service.confirmEnrollment(req, res, UID, 'factor-new', dto));
        expect(error.code).toBe('AUTH_MFA_TOO_MANY_ATTEMPTS');
        expect(oidc.destroyMfaPending).toHaveBeenCalledWith(UID);
      });

      it('其他錯誤（因子不存在）原樣拋出、不計入失敗', async () => {
        const { service, mfa, loginThrottle } = setup(enrollPending);
        mfa.confirmEnrollment.mockRejectedValue(new AppException('MFA_FACTOR_NOT_FOUND'));
        const error = await rejection(service.confirmEnrollment(req, res, UID, 'factor-new', dto));
        expect(error.code).toBe('MFA_FACTOR_NOT_FOUND');
        expect(loginThrottle.recordFailure).not.toHaveBeenCalled();
      });

      it('非 AppException 的錯誤原樣拋出、不計入失敗', async () => {
        const { service, mfa, loginThrottle } = setup(enrollPending);
        const boom = new Error('db down');
        mfa.confirmEnrollment.mockRejectedValue(boom);
        await expect(service.confirmEnrollment(req, res, UID, 'factor-new', dto)).rejects.toBe(
          boom,
        );
        expect(loginThrottle.recordFailure).not.toHaveBeenCalled();
      });

      it('MfaPending 已被消耗 → AUTH_MFA_PENDING_INVALID', async () => {
        const { service, oidc, tenant } = setup(enrollPending);
        oidc.consumeMfaPending.mockResolvedValue(false);
        const error = await rejection(service.confirmEnrollment(req, res, UID, 'factor-new', dto));
        expect(error.code).toBe('AUTH_MFA_PENDING_INVALID');
        expect(tenant.store.completeLogin).not.toHaveBeenCalled();
      });
    });
  });
});
