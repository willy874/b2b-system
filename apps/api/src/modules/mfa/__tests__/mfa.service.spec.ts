import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import { hashRecoveryCode } from '@/core/mfa';
import type { MfaDeliver, MfaMethod, MfaRealm } from '@/core/mfa';

import { MFA_CHALLENGE_MAX_ATTEMPTS } from '../mfa.constants';
import { methodInfoOf, MfaService } from '../mfa.service';
import {
  account,
  ADMIN_ID,
  challenge,
  factor,
  fakeStore,
  method,
  registryOf,
  storedAccount,
  USER_ID,
} from './mfa.fixture';

const NOW = new Date('2026-10-08T08:00:00.000Z');
const ACTOR: AuthUser = { id: 'admin-1', email: 'admin@example.com', status: 'active' };

function setup(options: { available?: string[] } = {}) {
  const totp = method('totp', { maxFactorsPerAccount: 2 });
  const email = method(
    'email',
    { challenge: 'server', maxFactorsPerAccount: 1, assurance: 'inbox' },
    {
      startChallenge: vi.fn(async () => ({
        state: { codeHmac: 'h' },
        expiresInSeconds: 600,
        resendAfterSeconds: 60,
        hint: 't***@example.com',
      })),
      beginEnrollment: vi.fn(async () => ({ config: { to: 'x' }, publicData: {} })),
    },
  );
  const passkey = method('passkey', { enrollAt: 'idp' });
  const hardware = method('hardware', { realms: ['platform'] });
  const noStart = method('noStart', { challenge: 'server' });
  const registry = registryOf(totp, email, passkey, hardware, noStart);
  const secrets = { encrypt: vi.fn((plain: string) => `enc:${plain}`) };
  const availability = {
    methodsFor: vi.fn(async (realm: MfaRealm) =>
      registry
        .list(realm)
        .filter(
          (m) => options.available === undefined || options.available.includes(m.definition.id),
        ),
    ),
    isRequired: vi.fn(async () => false),
    assertCanRemove: vi.fn(async () => undefined),
  };
  const notifier = { securityChanged: vi.fn(async () => undefined) };
  const tenant = fakeStore('tenant');
  const platform = fakeStore('platform');
  const delivery = { bind: vi.fn() };
  const service = new MfaService(
    registry,
    secrets as never,
    availability as never,
    notifier as never,
    tenant.asStore as never,
    platform.asStore as never,
    delivery as never,
  );
  return {
    service,
    registry,
    secrets,
    availability,
    notifier,
    tenant,
    platform,
    delivery,
    totp,
    email,
    passkey,
    noStart,
  };
}

/** onModuleInit 綁給 core 的 deliverChallenge（§9.2）。 */
function bound(ctx: ReturnType<typeof setup>) {
  ctx.service.onModuleInit();
  return ctx.delivery.bind.mock.calls[0]![0] as (
    realm: MfaRealm,
    accountId: string,
    challengeId: string,
    deliver: MfaDeliver,
  ) => Promise<unknown>;
}

/** 以租戶帳號驗證一次。 */
function run(
  ctx: ReturnType<typeof setup>,
  target = factor(),
  challengeId: string | undefined = undefined,
  payload: unknown = { code: '123456' },
  purpose: 'login' | 'enroll' = 'login',
) {
  return ctx.service.verifyFactor(
    ctx.tenant.asStore,
    storedAccount(),
    target,
    challengeId,
    payload,
    purpose,
  );
}

async function rejection(promise: Promise<unknown>): Promise<AppException> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  return error as AppException;
}

describe('MfaService（docs/architecture/backend/21-mfa.md §1、§7、§8）', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('methodInfoOf 只取 API 需要的定義欄位', () => {
    expect(methodInfoOf(method('totp'))).toEqual({
      id: 'totp',
      challenge: 'none',
      enrollAt: 'anywhere',
      assurance: 'possession',
      maxFactorsPerAccount: 5,
    });
  });

  describe('基本工具', () => {
    it('store 依身分範圍選擇租戶或平台的儲存', () => {
      const { service, tenant, platform } = setup();
      expect(service.store('tenant')).toBe(tenant.asStore);
      expect(service.store('platform')).toBe(platform.asStore);
    });

    it('context 的 enqueue 帶著同一個交易入列', async () => {
      const { service, tenant } = setup();
      const ctx = service.context(tenant.asStore, account(), tenant.tx);
      expect(ctx).toMatchObject({ realm: 'tenant', account: account() });
      await ctx.enqueue({ name: 'job' } as never, { a: 1 });
      expect(tenant.store.enqueue).toHaveBeenCalledWith({ name: 'job' }, { a: 1 }, tenant.tx);
    });

    it('amrOf：註冊表裡的方式用它的 amr，已移除的方式只寫 mfa（D12）', () => {
      const { service } = setup();
      expect(service.amrOf('totp')).toBe('totpAmr');
      expect(service.amrOf('legacy')).toBe('mfa');
    });

    it.each([
      ['tenant', 'USER_NOT_FOUND'],
      ['platform', 'PLATFORM_ADMIN_NOT_FOUND'],
    ] as const)('requireAccount：%s 的帳號不存在 → %s', async (realm, code) => {
      const { service } = setup();
      const store = fakeStore(realm);
      store.store.findAccount.mockResolvedValue(undefined);
      expect((await rejection(service.requireAccount(store.asStore, 'x'))).code).toBe(code);
    });

    it('factorDto：方式提供的名稱、可用與否、以確認時間為建立時間', () => {
      const { service } = setup();
      const dto = service.factorDto(
        factor({
          label: 'Phone',
          confirmedAt: new Date('2026-10-02T00:00:00.000Z'),
          lastUsedAt: new Date('2026-10-03T00:00:00.000Z'),
        }),
        account(),
        new Set(['totp']),
      );
      expect(dto).toEqual({
        id: 'factor-1',
        method: 'totp',
        label: 'Phone',
        hint: null,
        available: true,
        createdAt: '2026-10-02T00:00:00.000Z',
        lastUsedAt: '2026-10-03T00:00:00.000Z',
      });
    });

    it('factorDto：不在註冊表的方式用因子自己的名稱，且標為不可用', () => {
      const { service } = setup();
      const dto = service.factorDto(
        factor({ method: 'legacy', label: 'Old' }),
        account(),
        new Set(['legacy']),
      );
      expect(dto).toMatchObject({
        label: 'Old',
        hint: null,
        available: false,
        createdAt: '2026-10-01T00:00:00.000Z',
        lastUsedAt: null,
      });
    });

    it('afterSecurityChange 交給通知者在同一個交易入列', async () => {
      const { service, notifier, tenant } = setup();
      await service.afterSecurityChange(tenant.asStore, account(), 'reset', tenant.tx);
      expect(notifier.securityChanged).toHaveBeenCalledWith(
        tenant.asStore,
        account(),
        'reset',
        tenant.tx,
      );
    });
  });

  describe('寄出 challenge（onModuleInit 綁定的 deliverChallenge，§9.2）', () => {
    const send = vi.fn(async () => undefined);
    const deliver = vi.fn(async () => ({ state: { codeHmac: 'new' }, send }));

    it.each([
      ['帳號不存在', undefined],
      ['帳號已停用', storedAccount('tenant', { active: false })],
    ])('%s → account_inactive', async (_label, stored) => {
      const ctx = setup();
      ctx.tenant.store.findAccount.mockResolvedValue(stored);
      expect(await bound(ctx)('tenant', USER_ID, 'challenge-1', deliver)).toEqual({
        delivered: false,
        reason: 'account_inactive',
      });
    });

    it('challenge 不存在 → challenge_not_found', async () => {
      const ctx = setup();
      expect(await bound(ctx)('tenant', USER_ID, 'challenge-1', deliver)).toEqual({
        delivered: false,
        reason: 'challenge_not_found',
      });
    });

    it.each([
      ['已消耗', { consumedAt: new Date() }],
      ['已過期', { expiresAt: new Date(NOW.getTime()) }],
    ])('challenge %s → challenge_closed', async (_label, overrides) => {
      const ctx = setup();
      ctx.tenant.repo.findChallenge.mockResolvedValue(challenge(overrides));
      expect(await bound(ctx)('tenant', USER_ID, 'challenge-1', deliver)).toEqual({
        delivered: false,
        reason: 'challenge_closed',
      });
    });

    it('因子不存在 → factor_not_found', async () => {
      const ctx = setup();
      ctx.tenant.repo.findChallenge.mockResolvedValue(challenge());
      expect(await bound(ctx)('tenant', USER_ID, 'challenge-1', deliver)).toEqual({
        delivered: false,
        reason: 'factor_not_found',
      });
    });

    it('寫回狀態時 challenge 已被消耗 → challenge_closed，不寄', async () => {
      const ctx = setup();
      ctx.tenant.repo.findChallenge.mockResolvedValue(challenge());
      ctx.tenant.repo.findFactor.mockResolvedValue(factor({ method: 'email' }));
      ctx.tenant.repo.updateChallengeState.mockResolvedValue(false);
      send.mockClear();
      expect(await bound(ctx)('tenant', USER_ID, 'challenge-1', deliver)).toEqual({
        delivered: false,
        reason: 'challenge_closed',
      });
      expect(send).not.toHaveBeenCalled();
    });

    it('寫回方式產生的狀態後寄出，回傳 challenge 建立至今的時間（平台帳號用平台的儲存）', async () => {
      const ctx = setup();
      const open = challenge({ createdAt: new Date(NOW.getTime() - 2_500) });
      const emailFactor = factor({ method: 'email', accountId: ADMIN_ID });
      ctx.platform.repo.findChallenge.mockResolvedValue(open);
      ctx.platform.repo.findFactor.mockResolvedValue(emailFactor);
      send.mockClear();
      const result = await bound(ctx)('platform', ADMIN_ID, 'challenge-1', deliver);
      expect(result).toEqual({ delivered: true, challengeAgeMs: 2_500 });
      expect(deliver).toHaveBeenCalledWith(
        expect.objectContaining({ realm: 'platform', account: account('platform') }),
        open,
        emailFactor,
      );
      expect(ctx.platform.repo.updateChallengeState).toHaveBeenCalledWith('challenge-1', {
        codeHmac: 'new',
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(ctx.tenant.store.findAccount).not.toHaveBeenCalled();
    });
  });

  describe('overview（§7）', () => {
    it('只列 active 的因子、每種方式已設定的數量、是否必須啟用', async () => {
      const { service, tenant, availability } = setup({ available: ['totp', 'email'] });
      tenant.repo.listFactors.mockResolvedValue([
        factor({ id: 'a' }),
        factor({ id: 'b', status: 'pending' }),
        factor({ id: 'c', method: 'email' }),
      ]);
      tenant.repo.countRecoveryCodes.mockResolvedValue(8);
      availability.isRequired.mockResolvedValue(true);
      const result = await service.overview('tenant', USER_ID);
      expect(result.factors.map((f) => f.id)).toEqual(['a', 'c']);
      expect(result.recoveryCodesRemaining).toBe(8);
      expect(result.required).toBe(true);
      expect(result.methods.map((m) => [m.id, m.enrolled])).toEqual([
        ['totp', 1],
        ['email', 1],
      ]);
    });

    it('沒有 active 的因子時備用碼顯示 0', async () => {
      const { service, tenant } = setup();
      tenant.repo.countRecoveryCodes.mockResolvedValue(3);
      expect((await service.overview('tenant', USER_ID)).recoveryCodesRemaining).toBe(0);
    });
  });

  describe('startEnrollment', () => {
    it('不在註冊表的方式 → MFA_METHOD_NOT_FOUND', async () => {
      const { service } = setup();
      expect((await rejection(service.startEnrollment('tenant', USER_ID, 'sms'))).code).toBe(
        'MFA_METHOD_NOT_FOUND',
      );
    });

    it('不能用在這個身分範圍的方式 → MFA_METHOD_NOT_FOUND', async () => {
      const { service } = setup();
      expect((await rejection(service.startEnrollment('tenant', USER_ID, 'hardware'))).code).toBe(
        'MFA_METHOD_NOT_FOUND',
      );
    });

    it('方式被關掉 → MFA_METHOD_DISABLED', async () => {
      const { service } = setup({ available: ['email'] });
      const error = await rejection(service.startEnrollment('tenant', USER_ID, 'totp'));
      expect(error.code).toBe('MFA_METHOD_DISABLED');
      expect(error.details).toEqual({ method: 'totp' });
    });

    it('綁 origin 的方式在租戶的自助頁設定 → MFA_METHOD_DISABLED（enrollAtIdp，D14）', async () => {
      const { service } = setup();
      const error = await rejection(service.startEnrollment('tenant', USER_ID, 'passkey'));
      expect(error.code).toBe('MFA_METHOD_DISABLED');
      expect(error.details).toEqual({ reason: 'enrollAtIdp' });
    });

    it.each([
      ['登入互動中', 'tenant', 'uid-1'],
      ['平台管理者', 'platform', null],
    ] as const)('綁 origin 的方式在%s可以設定', async (_label, realm, uid) => {
      const { service } = setup();
      await expect(
        service.startEnrollment(realm, realm === 'tenant' ? USER_ID : ADMIN_ID, 'passkey', uid),
      ).resolves.toMatchObject({ method: 'passkey' });
    });

    it('同一種方式已達上限 → MFA_FACTOR_LIMIT_REACHED', async () => {
      const { service, tenant } = setup();
      tenant.repo.listFactors.mockResolvedValue([
        factor({ id: 'a' }),
        factor({ id: 'b' }),
        factor({ id: 'c', status: 'pending' }),
      ]);
      const error = await rejection(service.startEnrollment('tenant', USER_ID, 'totp'));
      expect(error.code).toBe('MFA_FACTOR_LIMIT_REACHED');
      expect(error.details).toEqual({ method: 'totp', max: 2 });
    });

    it('加密方式的機密存成 pending 的因子，先作廢上一次沒確認的設定', async () => {
      const { service, tenant, totp, secrets } = setup();
      vi.mocked(totp.beginEnrollment).mockResolvedValue({
        secret: 'SEED',
        publicData: { uri: 'otpauth://x' },
      });
      const result = await service.startEnrollment('tenant', USER_ID, 'totp', 'uid-1');
      expect(secrets.encrypt).toHaveBeenCalledWith('SEED');
      expect(tenant.repo.deletePendingFactors).toHaveBeenCalledWith(USER_ID, tenant.tx);
      expect(tenant.repo.insertFactor).toHaveBeenCalledWith(
        {
          accountId: USER_ID,
          method: 'totp',
          label: null,
          secretEncrypted: 'enc:SEED',
          config: {},
          interactionUid: 'uid-1',
        },
        tenant.tx,
      );
      expect(result).toEqual({
        factorId: 'factor-new',
        method: 'totp',
        publicData: { uri: 'otpauth://x' },
        challenge: null,
      });
    });

    it('challenge = server 的方式同時發出第一個 challenge；沒有機密時存 null', async () => {
      const { service, tenant, email } = setup();
      const result = await service.startEnrollment('tenant', USER_ID, 'email');
      expect(tenant.repo.insertFactor).toHaveBeenCalledWith(
        expect.objectContaining({ secretEncrypted: null, config: { to: 'x' } }),
        tenant.tx,
      );
      expect(email.startChallenge).toHaveBeenCalledWith(
        expect.objectContaining({ realm: 'tenant' }),
        expect.objectContaining({ id: 'factor-new' }),
        { id: expect.any(String), purpose: 'enroll' },
      );
      expect(result.challenge).toEqual({
        challengeId: expect.any(String),
        hint: 't***@example.com',
        expiresAt: new Date(NOW.getTime() + 600_000).toISOString(),
        resendAvailableAt: new Date(NOW.getTime() + 60_000).toISOString(),
      });
    });
  });

  describe('resendChallenge', () => {
    it('因子不存在 → MFA_FACTOR_NOT_FOUND', async () => {
      const { service } = setup();
      expect((await rejection(service.resendChallenge('tenant', USER_ID, 'x', 'login'))).code).toBe(
        'MFA_FACTOR_NOT_FOUND',
      );
    });

    it.each([
      ['設定用途但因子已是 active', 'enroll', 'active'],
      ['登入用途但因子還是 pending', 'login', 'pending'],
    ] as const)('%s → MFA_FACTOR_NOT_FOUND', async (_label, purpose, status) => {
      const { service, tenant } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor({ method: 'email', status }));
      expect(
        (await rejection(service.resendChallenge('tenant', USER_ID, 'factor-1', purpose))).code,
      ).toBe('MFA_FACTOR_NOT_FOUND');
    });

    it('不需要 challenge 的方式 → VALIDATION_FAILED（MFA_CHALLENGE_NOT_NEEDED）', async () => {
      const { service, tenant } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor());
      const error = await rejection(
        service.resendChallenge('tenant', USER_ID, 'factor-1', 'login'),
      );
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({ fields: { factorId: 'MFA_CHALLENGE_NOT_NEEDED' } });
    });

    it('在交易內發出新的 challenge，帶上互動 uid', async () => {
      const { service, tenant } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor({ method: 'email' }));
      await service.resendChallenge('tenant', USER_ID, 'factor-1', 'login', 'uid-1');
      expect(tenant.repo.insertChallenge).toHaveBeenCalledWith(
        expect.objectContaining({
          factorId: 'factor-1',
          purpose: 'login',
          interactionUid: 'uid-1',
        }),
        tenant.tx,
      );
    });
  });

  describe('issueChallenge（§4.2 冷卻與只留最新的 challenge）', () => {
    it('方式沒有實作 startChallenge → 程式錯誤', async () => {
      const { service, tenant, noStart } = setup();
      await expect(
        service.issueChallenge(tenant.asStore, account(), noStart, factor(), 'login', null, null),
      ).rejects.toThrow('noStart');
    });

    it('冷卻中 → RATE_LIMITED，帶無條件進位的剩餘秒數', async () => {
      const { service, tenant, email } = setup();
      tenant.repo.latestChallenge.mockResolvedValue(
        challenge({ resendAfter: new Date(NOW.getTime() + 1_200) }),
      );
      const error = await rejection(
        service.issueChallenge(tenant.asStore, account(), email, factor(), 'login', null, null),
      );
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.details).toEqual({ retryAfterSeconds: 2 });
      expect(tenant.repo.insertChallenge).not.toHaveBeenCalled();
    });

    it('冷卻已過：消耗上一個還沒用的 challenge 再發新的；沒有 hint 時為 null', async () => {
      const { service, tenant, email } = setup();
      tenant.repo.latestChallenge.mockResolvedValue(
        challenge({ id: 'old', resendAfter: new Date(NOW.getTime() - 1) }),
      );
      vi.mocked(email.startChallenge!).mockResolvedValue({
        state: {},
        expiresInSeconds: 300,
        resendAfterSeconds: 30,
      });
      const result = await service.issueChallenge(
        tenant.asStore,
        account(),
        email,
        factor(),
        'login',
        null,
        tenant.tx,
      );
      expect(tenant.repo.consumeChallenge).toHaveBeenCalledWith('old');
      expect(result.hint).toBeNull();
      expect(result.expiresAt).toBe(new Date(NOW.getTime() + 300_000).toISOString());
    });

    it('上一個 challenge 已消耗：冷卻不適用，也不再消耗', async () => {
      const { service, tenant, email } = setup();
      tenant.repo.latestChallenge.mockResolvedValue(
        challenge({ consumedAt: NOW, resendAfter: new Date(NOW.getTime() + 60_000) }),
      );
      await service.issueChallenge(tenant.asStore, account(), email, factor(), 'login', null, null);
      expect(tenant.repo.consumeChallenge).not.toHaveBeenCalled();
      expect(tenant.repo.insertChallenge).toHaveBeenCalled();
    });
  });

  describe('confirmEnrollment', () => {
    const dto = { payload: { code: '123456' } };

    it('因子不存在或不是 pending → MFA_FACTOR_NOT_FOUND', async () => {
      const { service, tenant } = setup();
      expect((await rejection(service.confirmEnrollment('tenant', USER_ID, 'x', dto))).code).toBe(
        'MFA_FACTOR_NOT_FOUND',
      );
      tenant.repo.findFactor.mockResolvedValue(factor({ status: 'active' }));
      expect(
        (await rejection(service.confirmEnrollment('tenant', USER_ID, 'factor-1', dto))).code,
      ).toBe('MFA_FACTOR_NOT_FOUND');
    });

    it.each([
      ['互動中設定的因子拿到自助頁確認', 'uid-1', undefined],
      ['自助設定的因子拿到互動裡確認', null, 'uid-1'],
      ['不同的互動', 'uid-1', 'uid-2'],
    ])('%s → MFA_FACTOR_NOT_FOUND', async (_label, factorUid, optionUid) => {
      const { service, tenant } = setup();
      tenant.repo.findFactor.mockResolvedValue(
        factor({ status: 'pending', interactionUid: factorUid }),
      );
      const error = await rejection(
        service.confirmEnrollment('tenant', USER_ID, 'factor-1', dto, {
          interactionUid: optionUid,
        }),
      );
      expect(error.code).toBe('MFA_FACTOR_NOT_FOUND');
    });

    it('驗證失敗 → 驗證結果的錯誤碼，不啟用因子', async () => {
      const { service, tenant, totp } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor({ status: 'pending' }));
      vi.mocked(totp.verify).mockResolvedValue({ ok: false, reason: 'invalid' });
      const error = await rejection(service.confirmEnrollment('tenant', USER_ID, 'factor-1', dto));
      expect(error.code).toBe('AUTH_MFA_INVALID_CODE');
      expect(tenant.repo.activateFactor).not.toHaveBeenCalled();
    });

    it('併發的另一次確認已啟用 → MFA_FACTOR_NOT_FOUND', async () => {
      const { service, tenant } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor({ status: 'pending' }));
      tenant.repo.activateFactor.mockResolvedValue(false);
      const error = await rejection(service.confirmEnrollment('tenant', USER_ID, 'factor-1', dto));
      expect(error.code).toBe('MFA_FACTOR_NOT_FOUND');
      expect(tenant.store.audit).not.toHaveBeenCalled();
    });

    it('第一個因子：啟用、產生 10 組備用碼（只存雜湊）、稽核、安全通知、推播 MFA 狀態', async () => {
      const { service, tenant, totp, notifier } = setup();
      const pending = factor({ status: 'pending', interactionUid: 'uid-1' });
      tenant.repo.findFactor
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(factor({ confirmedAt: NOW, label: 'Phone' }));
      tenant.repo.listFactors.mockResolvedValue([factor()]);
      vi.mocked(totp.verify).mockResolvedValue({ ok: true, counter: 42 });
      const result = await service.confirmEnrollment(
        'tenant',
        USER_ID,
        'factor-1',
        { ...dto, label: 'Phone' },
        { interactionUid: 'uid-1', actor: { id: 'someone', email: 's@example.com' } },
      );
      expect(tenant.repo.activateFactor).toHaveBeenCalledWith(
        'factor-1',
        { label: 'Phone', lastUsedCounter: 42 },
        tenant.tx,
      );
      expect(result.recoveryCodes).toHaveLength(10);
      expect(tenant.repo.replaceRecoveryCodes).toHaveBeenCalledWith(
        USER_ID,
        result.recoveryCodes!.map((code) => hashRecoveryCode(code)),
        tenant.tx,
      );
      expect(tenant.repo.syncMfaEnabled).toHaveBeenCalledWith(USER_ID, tenant.tx);
      expect(tenant.store.audit).toHaveBeenCalledWith(
        {
          kind: 'factorAdd',
          target: account(),
          actor: { id: 'someone', email: 's@example.com' },
          metadata: {
            method: 'totp',
            factorId: 'factor-1',
            duringLogin: true,
            recoveryCodesGenerated: 10,
          },
        },
        tenant.tx,
      );
      expect(notifier.securityChanged).toHaveBeenCalledWith(
        tenant.asStore,
        account(),
        'factorAdded',
        tenant.tx,
      );
      expect(tenant.store.mfaStatusChanged).toHaveBeenCalledWith(USER_ID);
      expect(result.factor).toMatchObject({
        label: 'Phone',
        available: true,
        createdAt: NOW.toISOString(),
      });
    });

    it('不是第一個因子：不產生備用碼；已啟用 MFA 時不推播；查不到啟用後的因子時用原本的', async () => {
      const { service, tenant } = setup();
      tenant.store.findAccount.mockResolvedValue(storedAccount('tenant', { mfaEnabled: true }));
      tenant.repo.findFactor
        .mockResolvedValueOnce(factor({ status: 'pending' }))
        .mockResolvedValueOnce(undefined);
      tenant.repo.listFactors.mockResolvedValue([factor({ id: 'a' }), factor({ id: 'b' })]);
      const result = await service.confirmEnrollment('tenant', USER_ID, 'factor-1', dto);
      expect(result.recoveryCodes).toBeNull();
      expect(tenant.repo.replaceRecoveryCodes).not.toHaveBeenCalled();
      expect(tenant.store.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: undefined,
          metadata: { method: 'totp', factorId: 'factor-1', duringLogin: false },
        }),
        tenant.tx,
      );
      expect(tenant.store.mfaStatusChanged).not.toHaveBeenCalled();
      expect(result.factor.id).toBe('factor-1');
    });
  });

  describe('removeFactor', () => {
    it('密碼錯誤 → 寫失敗的稽核並拋 AUTH_PASSWORD_MISMATCH', async () => {
      const { service, tenant } = setup();
      tenant.store.verifyPassword.mockResolvedValue(false);
      const error = await rejection(service.removeFactor('tenant', USER_ID, 'factor-1', 'bad'));
      expect(error.code).toBe('AUTH_PASSWORD_MISMATCH');
      expect(tenant.store.audit).toHaveBeenCalledWith({
        kind: 'factorRemove',
        target: account(),
        result: 'failure',
        errorCode: 'AUTH_PASSWORD_MISMATCH',
        metadata: { reason: 'password_mismatch' },
      });
      expect(tenant.repo.deleteFactor).not.toHaveBeenCalled();
    });

    it('因子不存在或不是 active → MFA_FACTOR_NOT_FOUND', async () => {
      const { service, tenant } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor({ status: 'pending' }));
      expect(
        (await rejection(service.removeFactor('tenant', USER_ID, 'factor-1', 'pw'))).code,
      ).toBe('MFA_FACTOR_NOT_FOUND');
    });

    it('必須啟用的人移除最後一個可用的因子 → assertCanRemove 的錯誤，不刪除', async () => {
      const { service, tenant, availability } = setup();
      tenant.repo.findFactor.mockResolvedValue(factor());
      availability.assertCanRemove.mockRejectedValue(new AppException('MFA_LAST_FACTOR'));
      expect(
        (await rejection(service.removeFactor('tenant', USER_ID, 'factor-1', 'pw'))).code,
      ).toBe('MFA_LAST_FACTOR');
      expect(tenant.repo.deleteFactor).not.toHaveBeenCalled();
    });

    it('移除最後一個因子：備用碼一起刪、MFA 狀態改變時推播', async () => {
      const { service, tenant, availability, notifier } = setup();
      tenant.store.findAccount.mockResolvedValue(storedAccount('tenant', { mfaEnabled: true }));
      const target = factor();
      tenant.repo.findFactor.mockResolvedValue(target);
      tenant.repo.listFactors.mockResolvedValue([target, factor({ id: 'p', status: 'pending' })]);
      tenant.repo.syncMfaEnabled.mockResolvedValue(false);
      expect(await service.removeFactor('tenant', USER_ID, 'factor-1', 'pw')).toEqual({
        success: true,
      });
      expect(availability.assertCanRemove).toHaveBeenCalledWith(
        tenant.asStore,
        expect.anything(),
        target,
        [],
      );
      expect(tenant.repo.deleteFactor).toHaveBeenCalledWith(USER_ID, 'factor-1', tenant.tx);
      expect(tenant.repo.replaceRecoveryCodes).toHaveBeenCalledWith(USER_ID, [], tenant.tx);
      expect(tenant.store.audit).toHaveBeenCalledWith(
        {
          kind: 'factorRemove',
          target: account(),
          metadata: { method: 'totp', factorId: 'factor-1', remaining: 0 },
        },
        tenant.tx,
      );
      expect(notifier.securityChanged).toHaveBeenCalledWith(
        tenant.asStore,
        account(),
        'factorRemoved',
        tenant.tx,
      );
      expect(tenant.store.mfaStatusChanged).toHaveBeenCalledWith(USER_ID);
    });

    it('還有其他因子：保留備用碼，MFA 狀態沒變時不推播', async () => {
      const { service, tenant } = setup();
      tenant.store.findAccount.mockResolvedValue(storedAccount('tenant', { mfaEnabled: true }));
      tenant.repo.findFactor.mockResolvedValue(factor());
      tenant.repo.listFactors.mockResolvedValue([factor(), factor({ id: 'other' })]);
      await service.removeFactor('tenant', USER_ID, 'factor-1', 'pw');
      expect(tenant.repo.replaceRecoveryCodes).not.toHaveBeenCalled();
      expect(tenant.store.mfaStatusChanged).not.toHaveBeenCalled();
    });
  });

  describe('regenerateRecoveryCodes', () => {
    it('密碼錯誤 → AUTH_PASSWORD_MISMATCH（稽核記 recoveryRegenerate）', async () => {
      const { service, platform } = setup();
      platform.store.verifyPassword.mockResolvedValue(false);
      expect(
        (await rejection(service.regenerateRecoveryCodes('platform', ADMIN_ID, 'bad'))).code,
      ).toBe('AUTH_PASSWORD_MISMATCH');
      expect(platform.store.audit).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'recoveryRegenerate', result: 'failure' }),
      );
    });

    it('沒有 active 的因子 → MFA_FACTOR_NOT_FOUND', async () => {
      const { service, tenant } = setup();
      tenant.repo.listFactors.mockResolvedValue([factor({ status: 'pending' })]);
      expect((await rejection(service.regenerateRecoveryCodes('tenant', USER_ID, 'pw'))).code).toBe(
        'MFA_FACTOR_NOT_FOUND',
      );
    });

    it('產生新的備用碼取代舊的、寫稽核與安全通知', async () => {
      const { service, tenant, notifier } = setup();
      tenant.repo.listFactors.mockResolvedValue([factor()]);
      const { recoveryCodes } = await service.regenerateRecoveryCodes('tenant', USER_ID, 'pw');
      expect(recoveryCodes).toHaveLength(10);
      expect(tenant.repo.replaceRecoveryCodes).toHaveBeenCalledWith(
        USER_ID,
        recoveryCodes.map((code) => hashRecoveryCode(code)),
        tenant.tx,
      );
      expect(tenant.store.audit).toHaveBeenCalledWith(
        { kind: 'recoveryRegenerate', target: account(), metadata: { remaining: 10 } },
        tenant.tx,
      );
      expect(notifier.securityChanged).toHaveBeenCalledWith(
        tenant.asStore,
        account(),
        'recoveryCodesRegenerated',
        tenant.tx,
      );
    });
  });

  describe('status 與 reset（§8）', () => {
    it('status：有 active 的因子時 enabled 並顯示剩餘備用碼', async () => {
      const { service, tenant } = setup();
      tenant.repo.listFactors.mockResolvedValue([factor(), factor({ id: 'p', status: 'pending' })]);
      tenant.repo.countRecoveryCodes.mockResolvedValue(5);
      const result = await service.status('tenant', USER_ID);
      expect(result).toMatchObject({ enabled: true, recoveryCodesRemaining: 5 });
      expect(result.factors).toHaveLength(1);
    });

    it('status：沒有因子時 disabled、備用碼 0', async () => {
      const { service, tenant } = setup();
      tenant.repo.countRecoveryCodes.mockResolvedValue(5);
      expect(await service.status('tenant', USER_ID)).toEqual({
        enabled: false,
        factors: [],
        recoveryCodesRemaining: 0,
      });
    });

    it('reset：刪除因子與備用碼、結束 session、severity high 的稽核、通知信、推播', async () => {
      const { service, tenant, notifier } = setup();
      tenant.store.findAccount.mockResolvedValue(storedAccount('tenant', { mfaEnabled: true }));
      tenant.repo.listFactors.mockResolvedValue([
        factor({ id: 'a' }),
        factor({ id: 'b' }),
        factor({ id: 'c', method: 'email' }),
        factor({ id: 'd', method: 'legacy', status: 'pending' }),
      ]);
      tenant.repo.deleteFactors.mockResolvedValue(4);
      expect(await service.reset('tenant', ACTOR, USER_ID)).toEqual({ success: true });
      expect(tenant.repo.deleteFactors).toHaveBeenCalledWith(USER_ID, tenant.tx);
      expect(tenant.repo.replaceRecoveryCodes).toHaveBeenCalledWith(USER_ID, [], tenant.tx);
      expect(tenant.repo.syncMfaEnabled).toHaveBeenCalledWith(USER_ID, tenant.tx);
      expect(tenant.store.revokeSessions).toHaveBeenCalledWith(USER_ID, tenant.tx);
      expect(tenant.store.audit).toHaveBeenCalledWith(
        {
          kind: 'reset',
          target: account(),
          actor: { id: ACTOR.id, email: ACTOR.email },
          metadata: { severity: 'high', removedFactors: 4, methods: ['totp', 'email'] },
        },
        tenant.tx,
      );
      expect(notifier.securityChanged).toHaveBeenCalledWith(
        tenant.asStore,
        account(),
        'reset',
        tenant.tx,
      );
      expect(tenant.store.mfaStatusChanged).toHaveBeenCalledWith(USER_ID);
    });

    it('reset：原本沒啟用 MFA 時不推播', async () => {
      const { service, platform } = setup();
      await service.reset('platform', ACTOR, ADMIN_ID);
      expect(platform.store.mfaStatusChanged).not.toHaveBeenCalled();
    });
  });

  describe('verifyFactor（D2：次數、consumed、重放由框架處理）', () => {
    it('不在註冊表的方式 → MFA_METHOD_NOT_FOUND', async () => {
      const ctx = setup();
      expect((await rejection(run(ctx, factor({ method: 'legacy' })))).code).toBe(
        'MFA_METHOD_NOT_FOUND',
      );
    });

    it('payload 不合方式的 schema → invalid，不呼叫方式', async () => {
      const ctx = setup();
      expect(await run(ctx, factor(), undefined, { code: 1 })).toEqual({
        ok: false,
        reason: 'invalid',
        code: 'AUTH_MFA_INVALID_CODE',
      });
      expect(ctx.totp.verify).not.toHaveBeenCalled();
    });

    describe('challenge = server', () => {
      const emailFactor = factor({ method: 'email' });

      it('沒帶 challengeId → expired', async () => {
        const ctx = setup();
        expect(await run(ctx, emailFactor)).toEqual({
          ok: false,
          reason: 'expired',
          code: 'AUTH_MFA_CHALLENGE_EXPIRED',
        });
        expect(ctx.tenant.repo.findChallenge).not.toHaveBeenCalled();
      });

      // challenge 在測試裡（假時鐘設好之後）才產生，每一列只有它描述的那一項不符
      it.each([
        ['不存在', () => undefined],
        ['屬於別的因子', () => challenge({ factorId: 'other' })],
        ['用途不同', () => challenge({ purpose: 'enroll' })],
        ['已消耗', () => challenge({ consumedAt: NOW })],
        ['已過期', () => challenge({ expiresAt: NOW })],
        ['錯太多次', () => challenge({ attempts: MFA_CHALLENGE_MAX_ATTEMPTS })],
      ])('challenge %s → expired', async (_label, found) => {
        const ctx = setup();
        ctx.tenant.repo.findChallenge.mockResolvedValue(found());
        const result = await run(ctx, emailFactor, 'challenge-1');
        expect(result).toMatchObject({ ok: false, reason: 'expired' });
        expect(ctx.email.verify).not.toHaveBeenCalled();
      });

      it('碼錯 → 累計 challenge 的錯誤次數', async () => {
        const ctx = setup();
        ctx.tenant.repo.findChallenge.mockResolvedValue(challenge());
        vi.mocked(ctx.email.verify).mockResolvedValue({ ok: false, reason: 'invalid' });
        expect(await run(ctx, emailFactor, 'challenge-1')).toMatchObject({
          ok: false,
          reason: 'invalid',
        });
        expect(ctx.tenant.repo.incrementChallengeAttempts).toHaveBeenCalledWith('challenge-1');
      });

      it('併發的同一個碼已消耗 challenge → replayed', async () => {
        const ctx = setup();
        ctx.tenant.repo.findChallenge.mockResolvedValue(challenge());
        ctx.tenant.repo.consumeChallenge.mockResolvedValue(false);
        expect(await run(ctx, emailFactor, 'challenge-1')).toEqual({
          ok: false,
          reason: 'replayed',
          code: 'AUTH_MFA_INVALID_CODE',
        });
      });

      it('成功：消耗 challenge，把它交給方式驗證', async () => {
        const ctx = setup();
        const open = challenge();
        ctx.tenant.repo.findChallenge.mockResolvedValue(open);
        const result = await run(ctx, emailFactor, 'challenge-1');
        expect(result).toEqual({ ok: true, method: ctx.email, counter: null });
        expect(ctx.email.verify).toHaveBeenCalledWith(
          expect.objectContaining({ realm: 'tenant' }),
          emailFactor,
          open,
          { code: '123456' },
        );
        expect(ctx.tenant.repo.consumeChallenge).toHaveBeenCalledWith('challenge-1');
        expect(ctx.tenant.repo.findChallenge).toHaveBeenCalledWith(USER_ID, 'challenge-1');
      });
    });

    it('沒有 challenge 的方式碼錯 → 不累計次數', async () => {
      const ctx = setup();
      vi.mocked(ctx.totp.verify).mockResolvedValue({ ok: false, reason: 'expired' });
      expect(await run(ctx)).toMatchObject({ ok: false, reason: 'expired' });
      expect(ctx.tenant.repo.incrementChallengeAttempts).not.toHaveBeenCalled();
    });

    it('active 的因子：計數不大於上一次接受的值 → replayed，不記錄使用', async () => {
      const ctx = setup();
      vi.mocked(ctx.totp.verify).mockResolvedValue({ ok: true, counter: 10 });
      expect(await run(ctx, factor({ lastUsedCounter: 10 }))).toMatchObject({
        ok: false,
        reason: 'replayed',
      });
      expect(ctx.tenant.repo.recordFactorUse).not.toHaveBeenCalled();
    });

    it('active 的因子：條件式記錄使用失敗（併發）→ replayed', async () => {
      const ctx = setup();
      vi.mocked(ctx.totp.verify).mockResolvedValue({ ok: true, counter: 11 });
      ctx.tenant.repo.recordFactorUse.mockResolvedValue(false);
      expect(await run(ctx, factor({ lastUsedCounter: 10 }))).toMatchObject({
        ok: false,
        reason: 'replayed',
      });
    });

    it('active 的因子成功：記下新的計數', async () => {
      const ctx = setup();
      vi.mocked(ctx.totp.verify).mockResolvedValue({ ok: true, counter: 11 });
      expect(await run(ctx, factor({ lastUsedCounter: 10 }))).toEqual({
        ok: true,
        method: ctx.totp,
        counter: 11,
      });
      expect(ctx.tenant.repo.recordFactorUse).toHaveBeenCalledWith('factor-1', 11);
    });

    it('active 的因子第一次使用（沒有上一次的計數）不算重放', async () => {
      const ctx = setup();
      vi.mocked(ctx.totp.verify).mockResolvedValue({ ok: true, counter: 3 });
      expect(await run(ctx)).toMatchObject({ ok: true, counter: 3 });
    });

    it('pending 的因子（設定確認）不記錄使用', async () => {
      const ctx = setup();
      expect(
        await run(ctx, factor({ status: 'pending' }), undefined, { code: '1' }, 'enroll'),
      ).toEqual({ ok: true, method: ctx.totp, counter: null });
      expect(ctx.tenant.repo.recordFactorUse).not.toHaveBeenCalled();
    });
  });

  describe('verifyRecoveryCode', () => {
    it('格式不對的碼不查資料庫，回 false', async () => {
      const { service, tenant } = setup();
      expect(await service.verifyRecoveryCode(tenant.asStore, USER_ID, { code: '!!' })).toBe(false);
      expect(tenant.repo.consumeRecoveryCode).not.toHaveBeenCalled();
    });

    it.each([true, false])('格式正確時以雜湊消耗，回傳結果（%s）', async (consumed) => {
      const { service, tenant } = setup();
      tenant.repo.consumeRecoveryCode.mockResolvedValue(consumed);
      const code = 'ABCDE-FGH23';
      const hash = hashRecoveryCode(code);
      expect(hash).not.toBeNull();
      expect(await service.verifyRecoveryCode(tenant.asStore, USER_ID, { code })).toBe(consumed);
      expect(tenant.repo.consumeRecoveryCode).toHaveBeenCalledWith(USER_ID, hash);
    });
  });

  describe('requireAvailableMethod', () => {
    it('回傳可用的方式', async () => {
      const { service, tenant, totp } = setup();
      expect(await service.requireAvailableMethod(tenant.asStore, 'totp')).toBe(totp);
    });

    it('availableMethods 依帳號的身分範圍取用', async () => {
      const { service, platform, availability } = setup();
      const methods: MfaMethod[] = await service.availableMethods(platform.asStore);
      expect(availability.methodsFor).toHaveBeenCalledWith('platform');
      expect(methods.map((m) => m.definition.id)).toContain('hardware');
    });
  });
});
