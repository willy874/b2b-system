import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import type { ErrorCode } from '@/core/errors';
import { mfaVerifications } from '@/core/metrics';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  MfaChallengeDelivery,
  MfaMethodRegistry,
  MfaSecretService,
} from '@/core/mfa';
import type {
  MfaAccount,
  MfaAccountContext,
  MfaDeliver,
  MfaDeliveryResult,
  MfaChallenge,
  MfaFactor,
  MfaMethod,
  MfaPurpose,
  MfaRealm,
} from '@/core/mfa';

import type {
  ConfirmMfaEnrollmentDto,
  MfaAccountStatusDto,
  MfaChallengeInfoDto,
  MfaEnrollmentDto,
  MfaEnrollmentResultDto,
  MfaFactorDto,
  MfaMethodInfoDto,
  MfaOverviewDto,
} from './dto/mfa.dto';
import type { MfaAccountStore, MfaStoredAccount } from './mfa-account.store';
import { MfaAvailability } from './mfa-availability.service';
import { MfaNotifier } from './mfa-notifier';
import type { MfaSecurityEvent } from './mfa-security-event';
import { MFA_CHALLENGE_MAX_ATTEMPTS } from './mfa.constants';
import { PlatformMfaStore } from './platform-mfa.store';
import { TenantMfaStore } from './tenant-mfa.store';

/** 一次驗證的結果；失敗時帶要回給前端的錯誤碼（§4.2：第二步只有通過密碼的人看得到，可以區分）。 */
export type MfaVerifyOutcome =
  | { ok: true; method: MfaMethod; counter: number | null }
  | { ok: false; reason: 'invalid' | 'expired' | 'replayed'; code: ErrorCode };

/** 方式的定義 → API 的形狀。 */
export function methodInfoOf(method: MfaMethod): MfaMethodInfoDto {
  const { id, challenge, enrollAt, assurance, maxFactorsPerAccount } = method.definition;
  return { id, challenge, enrollAt, assurance, maxFactorsPerAccount };
}

/**
 * MFA 的框架（docs/architecture/backend/21-mfa.md §1、§7、§8）：與方式無關的設定、驗證、備用碼與管理員重設。
 * 方式只經 `MfaMethod` 介面呼叫（D1）；失敗次數、consumed、稽核、重放都在這裡（D2）；
 * 帳號與儲存經 `MfaAccountStore`，同一套流程服務租戶與平台（D5）。登入互動的第二步在 `MfaLoginService`。
 */
@Injectable()
export class MfaService implements OnModuleInit {
  constructor(
    private readonly registry: MfaMethodRegistry,
    private readonly secrets: MfaSecretService,
    private readonly availability: MfaAvailability,
    private readonly notifier: MfaNotifier,
    private readonly tenantStore: TenantMfaStore,
    private readonly platformStore: PlatformMfaStore,
    private readonly delivery: MfaChallengeDelivery,
  ) {}

  onModuleInit(): void {
    // 方式的背景工作（Email 驗證碼信）經 core 的入口讀寫 challenge，不依賴這個模組（D5）
    this.delivery.bind((realm, accountId, challengeId, deliver) =>
      this.deliverChallenge(realm, accountId, challengeId, deliver),
    );
  }

  /**
   * 方式的背景工作寄出 challenge（docs/architecture/backend/21-mfa.md §9.2）：帳號仍可登入、challenge 還有效時，
   * 由方式產生要存的狀態（碼的 HMAC）、寫回 challenge，再寄出。工作重試時換新的碼，舊的碼跟著失效。
   * 在帳號的脈絡裡呼叫（租戶的工作已在 `Tenancy.run` 裡）。
   */
  private async deliverChallenge(
    realm: MfaRealm,
    accountId: string,
    challengeId: string,
    deliver: MfaDeliver,
  ): Promise<MfaDeliveryResult> {
    const store = this.store(realm);
    const stored = await store.findAccount(accountId);
    // 入列到寄出之間帳號被停用、刪除或 MFA 被重設：不寄
    if (!stored?.active) return { delivered: false, reason: 'account_inactive' };
    const challenge = await store.repo.findChallenge(accountId, challengeId);
    if (!challenge) return { delivered: false, reason: 'challenge_not_found' };
    if (challenge.consumedAt !== null || challenge.expiresAt.getTime() <= Date.now()) {
      return { delivered: false, reason: 'challenge_closed' };
    }
    const factor = await store.repo.findFactor(accountId, challenge.factorId);
    if (!factor) return { delivered: false, reason: 'factor_not_found' };
    const { state, send } = await deliver(this.context(store, stored.account), challenge, factor);
    if (!(await store.repo.updateChallengeState(challenge.id, state))) {
      return { delivered: false, reason: 'challenge_closed' };
    }
    await send();
    return { delivered: true, challengeAgeMs: Date.now() - challenge.createdAt.getTime() };
  }

  store(realm: MfaRealm): MfaAccountStore {
    return realm === 'tenant' ? this.tenantStore : this.platformStore;
  }

  /** 給方式的脈絡；`tx` 有值時方式入列的工作與框架的寫入在同一個交易。 */
  context(store: MfaAccountStore, account: MfaAccount, tx?: unknown): MfaAccountContext {
    return {
      realm: store.realm,
      account,
      secrets: this.secrets,
      enqueue: (type, data) => store.enqueue(type, data, tx),
    };
  }

  /** 完成互動時寫進 amr 的值（D12）；方式已不在註冊表時只寫 `mfa`。 */
  amrOf(methodId: string): string {
    return this.registry.get(methodId)?.definition.amr ?? 'mfa';
  }

  /** 這個帳號現在可以用的方式（§4.1）。 */
  availableMethods(store: MfaAccountStore): Promise<MfaMethod[]> {
    return this.availability.methodsFor(store.realm);
  }

  async requireAccount(store: MfaAccountStore, accountId: string): Promise<MfaStoredAccount> {
    const stored = await store.findAccount(accountId);
    if (!stored) {
      throw new AppException(
        store.realm === 'tenant' ? 'USER_NOT_FOUND' : 'PLATFORM_ADMIN_NOT_FOUND',
      );
    }
    return stored;
  }

  factorDto(factor: MfaFactor, account: MfaAccount, available: ReadonlySet<string>): MfaFactorDto {
    const method = this.registry.get(factor.method);
    const summary = method?.describe(factor, account) ?? { label: factor.label, hint: null };
    return {
      id: factor.id,
      method: factor.method,
      label: summary.label,
      hint: summary.hint,
      available: method !== undefined && available.has(factor.method),
      createdAt: (factor.confirmedAt ?? factor.createdAt).toISOString(),
      lastUsedAt: factor.lastUsedAt?.toISOString() ?? null,
    };
  }

  // ── 自助（§7）─────────────────────────────────────────

  async overview(realm: MfaRealm, accountId: string): Promise<MfaOverviewDto> {
    const store = this.store(realm);
    const stored = await this.requireAccount(store, accountId);
    const [factors, methods, recoveryCodesRemaining, required] = await Promise.all([
      store.repo.listFactors(accountId),
      this.availableMethods(store),
      store.repo.countRecoveryCodes(accountId),
      this.availability.isRequired(store, stored),
    ]);
    const active = factors.filter((factor) => factor.status === 'active');
    const availableIds = new Set(methods.map((method) => method.definition.id));
    return {
      factors: active.map((factor) => this.factorDto(factor, stored.account, availableIds)),
      recoveryCodesRemaining: active.length > 0 ? recoveryCodesRemaining : 0,
      methods: methods.map((method) => ({
        ...methodInfoOf(method),
        enrolled: active.filter((factor) => factor.method === method.definition.id).length,
      })),
      required,
    };
  }

  /**
   * 開始設定：方式產生機密，框架存成 pending 的因子；`challenge = 'server'` 的方式同時發出第一個 challenge
   * （Email 寄出驗證碼：確認收得到才算設定完成）。`interactionUid` 有值時是登入互動中的首次設定（§4）。
   */
  async startEnrollment(
    realm: MfaRealm,
    accountId: string,
    methodId: string,
    interactionUid: string | null = null,
  ): Promise<MfaEnrollmentDto> {
    const store = this.store(realm);
    const stored = await this.requireAccount(store, accountId);
    const method = await this.requireAvailableMethod(store, methodId);
    // 綁 origin 的方式只能在 apps/platform 設定（D14）；這一版沒有這種方式，判斷留在這裡
    if (method.definition.enrollAt === 'idp' && interactionUid === null && realm === 'tenant') {
      throw new AppException('MFA_METHOD_DISABLED', { reason: 'enrollAtIdp' });
    }
    const factors = await store.repo.listFactors(accountId);
    const sameMethod = factors.filter(
      (factor) => factor.status === 'active' && factor.method === methodId,
    );
    if (sameMethod.length >= method.definition.maxFactorsPerAccount) {
      throw new AppException('MFA_FACTOR_LIMIT_REACHED', {
        method: methodId,
        max: method.definition.maxFactorsPerAccount,
      });
    }

    const start = await method.beginEnrollment(this.context(store, stored.account));
    return store.transaction(async (tx) => {
      // 同一個人同時只留一個沒確認的設定：上一次放棄的設定作廢
      await store.repo.deletePendingFactors(accountId, tx);
      const factor = await store.repo.insertFactor(
        {
          accountId,
          method: methodId,
          label: null,
          secretEncrypted: start.secret === undefined ? null : this.secrets.encrypt(start.secret),
          config: start.config ?? {},
          interactionUid,
        },
        tx,
      );
      const challenge =
        method.definition.challenge === 'server'
          ? await this.issueChallenge(
              store,
              stored.account,
              method,
              factor,
              'enroll',
              interactionUid,
              tx,
            )
          : null;
      return { factorId: factor.id, method: methodId, publicData: start.publicData, challenge };
    });
  }

  /** 重發 challenge（Email 重寄）；冷卻中回 `429 RATE_LIMITED`。 */
  async resendChallenge(
    realm: MfaRealm,
    accountId: string,
    factorId: string,
    purpose: MfaPurpose,
    interactionUid: string | null = null,
  ): Promise<MfaChallengeInfoDto> {
    const store = this.store(realm);
    const stored = await this.requireAccount(store, accountId);
    const factor = await store.repo.findFactor(accountId, factorId);
    const expectedStatus = purpose === 'enroll' ? 'pending' : 'active';
    if (!factor || factor.status !== expectedStatus) throw new AppException('MFA_FACTOR_NOT_FOUND');
    const method = await this.requireAvailableMethod(store, factor.method);
    if (method.definition.challenge !== 'server') {
      throw new AppException('VALIDATION_FAILED', {
        fields: { factorId: 'MFA_CHALLENGE_NOT_NEEDED' },
      });
    }
    return store.transaction((tx) =>
      this.issueChallenge(store, stored.account, method, factor, purpose, interactionUid, tx),
    );
  }

  /** 發出 challenge：同一個因子在冷卻時間內不重發（§4.2）。 */
  async issueChallenge(
    store: MfaAccountStore,
    account: MfaAccount,
    method: MfaMethod,
    factor: MfaFactor,
    purpose: MfaPurpose,
    interactionUid: string | null,
    tx: unknown,
  ): Promise<MfaChallengeInfoDto> {
    if (!method.startChallenge)
      throw new Error(`MFA 方式 ${method.definition.id} 沒有實作 startChallenge`);
    const latest = await store.repo.latestChallenge(factor.id);
    if (latest && latest.consumedAt === null && latest.resendAfter.getTime() > Date.now()) {
      throw new AppException('RATE_LIMITED', {
        retryAfterSeconds: Math.ceil((latest.resendAfter.getTime() - Date.now()) / 1000),
      });
    }
    // 同一個因子只留最新的 challenge：重寄之後舊的碼失效（§9.2）
    if (latest && latest.consumedAt === null) await store.repo.consumeChallenge(latest.id);
    const id = randomUUID();
    const start = await method.startChallenge(this.context(store, account, tx), factor, {
      id,
      purpose,
    });
    const now = Date.now();
    const challenge = await store.repo.insertChallenge(
      {
        id,
        accountId: account.id,
        factorId: factor.id,
        purpose,
        interactionUid,
        state: start.state,
        expiresAt: new Date(now + start.expiresInSeconds * 1000),
        resendAfter: new Date(now + start.resendAfterSeconds * 1000),
      },
      tx,
    );
    return {
      challengeId: challenge.id,
      hint: start.hint ?? null,
      expiresAt: challenge.expiresAt.toISOString(),
      resendAvailableAt: challenge.resendAfter.toISOString(),
    };
  }

  /**
   * 確認設定：驗證成功 → 因子改 active；這個人的 **第一個** 因子同時產生備用碼（只出現這一次）。
   * 錯誤的碼不併入登入的鎖定（已登入或已通過密碼），只受速率限制與 challenge 的次數限制。
   */
  async confirmEnrollment(
    realm: MfaRealm,
    accountId: string,
    factorId: string,
    dto: ConfirmMfaEnrollmentDto,
    options: { interactionUid?: string | null; actor?: { id: string; email: string } } = {},
  ): Promise<MfaEnrollmentResultDto> {
    const store = this.store(realm);
    const stored = await this.requireAccount(store, accountId);
    const factor = await store.repo.findFactor(accountId, factorId);
    if (!factor || factor.status !== 'pending') throw new AppException('MFA_FACTOR_NOT_FOUND');
    // 登入互動中設定的因子只能在同一個互動確認；自助設定的不能拿到互動裡確認
    if ((factor.interactionUid ?? null) !== (options.interactionUid ?? null)) {
      throw new AppException('MFA_FACTOR_NOT_FOUND');
    }
    await this.requireAvailableMethod(store, factor.method);

    const outcome = await this.verifyFactor(
      store,
      stored,
      factor,
      dto.challengeId,
      dto.payload,
      'enroll',
    );
    if (!outcome.ok) throw new AppException(outcome.code);

    const recoveryCodes = await store.transaction(async (tx) => {
      const label = dto.label ?? null;
      if (
        !(await store.repo.activateFactor(
          factor.id,
          { label, lastUsedCounter: outcome.counter },
          tx,
        ))
      ) {
        throw new AppException('MFA_FACTOR_NOT_FOUND');
      }
      const factors = await store.repo.listFactors(accountId, tx);
      const isFirst = factors.filter((row) => row.status === 'active').length === 1;
      const codes = isFirst ? generateRecoveryCodes() : null;
      if (codes) await store.repo.replaceRecoveryCodes(accountId, codes.map(hashOrThrow), tx);
      await store.repo.syncMfaEnabled(accountId, tx);
      await store.audit(
        {
          kind: 'factorAdd',
          target: stored.account,
          actor: options.actor,
          metadata: {
            method: factor.method,
            factorId: factor.id,
            duringLogin: Boolean(options.interactionUid),
            ...(codes && { recoveryCodesGenerated: codes.length }),
          },
        },
        tx,
      );
      await this.afterSecurityChange(store, stored.account, 'factorAdded', tx);
      return codes;
    });
    if (!stored.mfaEnabled) await store.mfaStatusChanged(accountId);

    const activated = await store.repo.findFactor(accountId, factor.id);
    const available = new Set((await this.availableMethods(store)).map((m) => m.definition.id));
    return {
      factor: this.factorDto(activated ?? factor, stored.account, available),
      recoveryCodes,
    };
  }

  /** 移除一個因子（要再輸入密碼）；全部移除時備用碼一起刪。 */
  async removeFactor(
    realm: MfaRealm,
    accountId: string,
    factorId: string,
    password: string,
  ): Promise<{ success: true }> {
    const store = this.store(realm);
    const stored = await this.requireAccount(store, accountId);
    await this.assertPassword(store, stored, password, 'factorRemove');
    const factor = await store.repo.findFactor(accountId, factorId);
    if (!factor || factor.status !== 'active') throw new AppException('MFA_FACTOR_NOT_FOUND');

    const enabled = await store.transaction(async (tx) => {
      const remaining = (await store.repo.listFactors(accountId, tx)).filter(
        (row) => row.status === 'active' && row.id !== factorId,
      );
      await this.availability.assertCanRemove(store, stored, factor, remaining);
      await store.repo.deleteFactor(accountId, factorId, tx);
      if (remaining.length === 0) await store.repo.replaceRecoveryCodes(accountId, [], tx);
      const nowEnabled = await store.repo.syncMfaEnabled(accountId, tx);
      await store.audit(
        {
          kind: 'factorRemove',
          target: stored.account,
          metadata: { method: factor.method, factorId: factor.id, remaining: remaining.length },
        },
        tx,
      );
      await this.afterSecurityChange(store, stored.account, 'factorRemoved', tx);
      return nowEnabled;
    });
    if (enabled !== stored.mfaEnabled) await store.mfaStatusChanged(accountId);
    return { success: true };
  }

  /** 重新產生備用碼（要再輸入密碼），舊的全部作廢。 */
  async regenerateRecoveryCodes(
    realm: MfaRealm,
    accountId: string,
    password: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const store = this.store(realm);
    const stored = await this.requireAccount(store, accountId);
    await this.assertPassword(store, stored, password, 'recoveryRegenerate');
    const factors = await store.repo.listFactors(accountId);
    // 備用碼是因子失效時的出路：沒有任何因子時沒有意義
    if (!factors.some((factor) => factor.status === 'active')) {
      throw new AppException('MFA_FACTOR_NOT_FOUND');
    }
    const codes = generateRecoveryCodes();
    await store.transaction(async (tx) => {
      await store.repo.replaceRecoveryCodes(accountId, codes.map(hashOrThrow), tx);
      await store.audit(
        {
          kind: 'recoveryRegenerate',
          target: stored.account,
          metadata: { remaining: codes.length },
        },
        tx,
      );
      await this.afterSecurityChange(store, stored.account, 'recoveryCodesRegenerated', tx);
    });
    return { recoveryCodes: codes };
  }

  // ── 管理員檢視與重設（§8）──────────────────────────────

  async status(realm: MfaRealm, accountId: string): Promise<MfaAccountStatusDto> {
    const store = this.store(realm);
    const stored = await this.requireAccount(store, accountId);
    const [factors, methods, recoveryCodesRemaining] = await Promise.all([
      store.repo.listFactors(accountId),
      this.availableMethods(store),
      store.repo.countRecoveryCodes(accountId),
    ]);
    const active = factors.filter((factor) => factor.status === 'active');
    const available = new Set(methods.map((method) => method.definition.id));
    return {
      enabled: active.length > 0,
      factors: active.map((factor) => this.factorDto(factor, stored.account, available)),
      recoveryCodesRemaining: active.length > 0 ? recoveryCodesRemaining : 0,
    };
  }

  /**
   * 管理員重設：刪除所有因子與備用碼、結束這個人所有的 session（`SESSIONS_REVOKED` 也作廢還在第二步的互動）、
   * 寄通知信；稽核 `severity: high`。反提權與「不能重設自己」由呼叫端（controller 的 service）先判斷。
   */
  async reset(realm: MfaRealm, actor: AuthUser, accountId: string): Promise<{ success: true }> {
    const store = this.store(realm);
    const stored = await this.requireAccount(store, accountId);
    const factors = await store.repo.listFactors(accountId);
    await store.transaction(async (tx) => {
      const removed = await store.repo.deleteFactors(accountId, tx);
      await store.repo.replaceRecoveryCodes(accountId, [], tx);
      await store.repo.syncMfaEnabled(accountId, tx);
      await store.revokeSessions(accountId, tx);
      await store.audit(
        {
          kind: 'reset',
          target: stored.account,
          actor: { id: actor.id, email: actor.email },
          metadata: {
            severity: 'high',
            removedFactors: removed,
            methods: [
              ...new Set(factors.filter((f) => f.status === 'active').map((f) => f.method)),
            ],
          },
        },
        tx,
      );
      await this.afterSecurityChange(store, stored.account, 'reset', tx);
    });
    if (stored.mfaEnabled) await store.mfaStatusChanged(accountId);
    return { success: true };
  }

  // ── 驗證（登入的第二步與設定的確認共用）────────────────

  /**
   * 以方式驗證一次（D2：方式只回傳結果，challenge 的次數、consumed、重放由這裡處理）。
   * `factor` 是 active（登入）或 pending（設定確認）；active 的因子成功時以條件式更新記下計數，同一個碼不能用兩次。
   */
  async verifyFactor(
    store: MfaAccountStore,
    stored: MfaStoredAccount,
    factor: MfaFactor,
    challengeId: string | undefined,
    payload: unknown,
    purpose: MfaPurpose,
  ): Promise<MfaVerifyOutcome> {
    const method = this.registry.get(factor.method);
    if (!method) throw new AppException('MFA_METHOD_NOT_FOUND');
    const parsed = method.verifySchema.safeParse(payload);
    if (!parsed.success) {
      return this.fail(method, purpose, 'invalid');
    }

    let challenge: MfaChallenge | null = null;
    if (method.definition.challenge === 'server') {
      challenge = challengeId
        ? ((await store.repo.findChallenge(stored.account.id, challengeId)) ?? null)
        : null;
      if (
        !challenge ||
        challenge.factorId !== factor.id ||
        challenge.purpose !== purpose ||
        challenge.consumedAt !== null ||
        challenge.expiresAt.getTime() <= Date.now() ||
        challenge.attempts >= MFA_CHALLENGE_MAX_ATTEMPTS
      ) {
        return this.fail(method, purpose, 'expired');
      }
    }

    const result = await method.verify(
      this.context(store, stored.account),
      factor,
      challenge,
      parsed.data,
    );
    if (!result.ok) {
      if (challenge) await store.repo.incrementChallengeAttempts(challenge.id);
      return this.fail(method, purpose, result.reason);
    }
    // 消耗 challenge、記下計數：兩個併發的同一個碼只有一個成功（§4.2 重放）
    if (challenge && !(await store.repo.consumeChallenge(challenge.id))) {
      return this.fail(method, purpose, 'replayed');
    }
    const counter = result.counter ?? null;
    if (factor.status === 'active') {
      if (
        counter !== null &&
        factor.lastUsedCounter !== null &&
        counter <= factor.lastUsedCounter
      ) {
        return this.fail(method, purpose, 'replayed');
      }
      if (!(await store.repo.recordFactorUse(factor.id, counter))) {
        return this.fail(method, purpose, 'replayed');
      }
    }
    mfaVerifications.inc({ method: method.definition.id, purpose, result: 'ok' });
    return { ok: true, method, counter };
  }

  /** 以備用碼驗證（只能用一次）。 */
  async verifyRecoveryCode(
    store: MfaAccountStore,
    accountId: string,
    payload: { code: string },
  ): Promise<boolean> {
    const hash = hashRecoveryCode(payload.code);
    const ok = hash !== null && (await store.repo.consumeRecoveryCode(accountId, hash));
    mfaVerifications.inc({ method: 'recovery', purpose: 'login', result: ok ? 'ok' : 'invalid' });
    return ok;
  }

  async requireAvailableMethod(store: MfaAccountStore, methodId: string): Promise<MfaMethod> {
    const method = this.registry.get(methodId);
    if (!method || !method.definition.realms.includes(store.realm)) {
      throw new AppException('MFA_METHOD_NOT_FOUND');
    }
    const available = await this.availableMethods(store);
    if (!available.some((candidate) => candidate.definition.id === methodId)) {
      throw new AppException('MFA_METHOD_DISABLED', { method: methodId });
    }
    return method;
  }

  /**
   * 會影響帳號安全的變更提交後要做的事（安全通知信，§7）。`tx` 是同一個交易：通知信在交易內入列，回滾時不寄。
   */
  async afterSecurityChange(
    store: MfaAccountStore,
    account: MfaAccount,
    event: MfaSecurityEvent,
    tx: unknown,
  ): Promise<void> {
    await this.notifier.securityChanged(store, account, event, tx);
  }

  private async assertPassword(
    store: MfaAccountStore,
    stored: MfaStoredAccount,
    password: string,
    kind: 'factorRemove' | 'recoveryRegenerate',
  ): Promise<void> {
    if (await store.verifyPassword(stored.account.id, password)) return;
    // 拿到 access token 的人可以在這裡猜密碼：失敗要查得到（限流見 @RateLimit('auth')）
    await store.audit({
      kind,
      target: stored.account,
      result: 'failure',
      errorCode: 'AUTH_PASSWORD_MISMATCH',
      metadata: { reason: 'password_mismatch' },
    });
    throw new AppException('AUTH_PASSWORD_MISMATCH');
  }

  private fail(
    method: MfaMethod,
    purpose: MfaPurpose,
    reason: 'invalid' | 'expired' | 'replayed',
  ): MfaVerifyOutcome {
    mfaVerifications.inc({ method: method.definition.id, purpose, result: reason });
    return {
      ok: false,
      reason,
      code: reason === 'expired' ? 'AUTH_MFA_CHALLENGE_EXPIRED' : 'AUTH_MFA_INVALID_CODE',
    };
  }
}

function hashOrThrow(code: string): string {
  const hash = hashRecoveryCode(code);
  if (hash === null) throw new Error('產生的備用碼格式不正確');
  return hash;
}
