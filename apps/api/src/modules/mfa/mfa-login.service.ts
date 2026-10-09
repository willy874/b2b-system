import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable } from '@nestjs/common';

import { AppException } from '@/core/errors';
import type { ErrorCode } from '@/core/errors';
import { getRequestContext } from '@/core/http';
import { MFA_RECOVERY_METHOD } from '@/core/mfa';
import type { MfaRealm } from '@/core/mfa';
import { ipPrefixOf, LoginThrottle } from '@/core/rate-limit';
import { Tenancy } from '@/core/tenant';
import type { UserRow } from '@/db/schema';
import { parseAccountId } from '@/modules/oidc-provider/oidc-account';
import { OidcProviderService } from '@/modules/oidc-provider/oidc-provider.service';
import type { MfaPending } from '@/modules/oidc-provider/oidc-provider.service';

import { RecoveryCodePayloadSchema } from './dto/mfa.dto';
import type {
  ConfirmMfaEnrollmentDto,
  MfaChallengeInfoDto,
  MfaEnrollmentDto,
  MfaLoginChallengeDto,
  MfaLoginVerifyDto,
  MfaLoginVerifyResultDto,
  SsoMfaChallengeNextDto,
  SsoMfaEnrollNextDto,
  StartMfaEnrollmentDto,
} from './dto/mfa.dto';
import type { MfaAccountStore, MfaStoredAccount } from './mfa-account.store';
import { MfaAvailability } from './mfa-availability.service';
import { MFA_PENDING_MAX_ATTEMPTS, MFA_PENDING_TTL_SECONDS } from './mfa.constants';
import { methodInfoOf, MfaService } from './mfa.service';

/** 密碼通過之後要做什麼（docs/architecture/backend/21-mfa.md §4.1）。 */
export type MfaRequirement = 'none' | 'challenge' | 'enroll' | 'unavailable';

/** `POST /oidc-interaction/:uid/login` 的回應（§4）。 */
export type SsoLoginResult = { redirectTo: string } | SsoMfaChallengeNextDto | SsoMfaEnrollNextDto;

/** 第二步的脈絡：互動、它的 MfaPending、帳號。 */
interface PendingContext {
  pending: MfaPending;
  store: MfaAccountStore;
  stored: MfaStoredAccount;
}

/**
 * 登入互動的第二步（docs/architecture/backend/21-mfa.md §4）：密碼通過之後、`finishInteraction` 之前。
 * 狀態存 `oidc_payloads` 的 `MfaPending`（D6）；密碼通過時 **不** 寫 `result.login`，握著 resume 網址跳不過第二步。
 * 失敗併入帳號的鎖定與漸進延遲（§4.2）。
 */
@Injectable()
export class MfaLoginService {
  constructor(
    private readonly mfa: MfaService,
    private readonly availability: MfaAvailability,
    private readonly oidc: OidcProviderService,
    private readonly tenancy: Tenancy,
    private readonly loginThrottle: LoginThrottle,
  ) {}

  /** §4.1 的判斷。 */
  async requirementFor(store: MfaAccountStore, stored: MfaStoredAccount): Promise<MfaRequirement> {
    const accountId = stored.account.id;
    const [factors, methods, recoveryCodes, required] = await Promise.all([
      store.repo.listFactors(accountId),
      this.mfa.availableMethods(store),
      store.repo.countRecoveryCodes(accountId),
      this.availability.isRequired(store, stored),
    ]);
    const available = new Set(methods.map((method) => method.definition.id));
    const active = factors.filter((factor) => factor.status === 'active');
    // 已設定的人一律要第二步，即使政策沒要求：使用者自己開的保護不因政策而失效
    if (active.some((factor) => available.has(factor.method))) return 'challenge';
    if (active.length > 0) return recoveryCodes > 0 ? 'challenge' : 'unavailable';
    if (!required) return 'none';
    // 必須啟用卻沒有可用的方式：fail-closed（D8）
    return available.size > 0 ? 'enroll' : 'unavailable';
  }

  /**
   * 直接登入（`POST /auth/login`，§10）：沒有第二步，已設定或必須啟用的帳號一律拒絕。
   * 在租戶的脈絡裡呼叫。
   */
  async isRequiredForDirectLogin(user: UserRow): Promise<boolean> {
    const store = this.mfa.store('tenant');
    const stored = await store.findAccount(user.id);
    if (!stored) return false;
    return (await this.requirementFor(store, stored)) !== 'none';
  }

  /**
   * 密碼通過之後（在帳號的脈絡裡呼叫：租戶的要在 `Tenancy.run` 裡）。不需要第二步時完成登入與互動；
   * 需要時存 `MfaPending`，回應告訴互動頁下一步。
   */
  async afterPassword(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    realm: MfaRealm,
    accountId: string,
    options: { enroll?: string | null } = {},
  ): Promise<SsoLoginResult> {
    const store = this.mfa.store(realm);
    const stored = await this.mfa.requireAccount(store, accountId);
    const requirement = await this.requirementFor(store, stored);
    const oidcAccountId = store.oidcAccountId(accountId);
    // 產品要求新增的方式（§7.1）：目前不能用（被關掉、政策不允許）就當作沒要求，照常登入
    const enroll = options.enroll ? await this.requestedEnrollment(store, options.enroll) : null;

    if (requirement === 'none' && enroll) {
      await this.oidc.saveMfaPending(
        uid,
        {
          accountId: oidcAccountId,
          firstFactor: 'pwd',
          next: 'mfaEnroll',
          attempts: 0,
          enroll: enroll.id,
          optional: true,
          amr: ['pwd'],
        },
        MFA_PENDING_TTL_SECONDS,
      );
      return { next: 'mfaEnroll', methods: [enroll], optional: true };
    }
    if (requirement === 'none') {
      await store.completeLogin(stored, { amr: ['pwd'] });
      const redirectTo = await this.oidc.finishInteraction(req, res, {
        login: { accountId: oidcAccountId, amr: ['pwd'] },
      });
      return { redirectTo };
    }
    if (requirement === 'unavailable') {
      // 有因子但方式全部被關掉、也沒有備用碼；或必須啟用卻沒有可用的方式（D8）
      await store.audit({
        kind: 'loginFailure',
        target: stored.account,
        result: 'failure',
        errorCode: 'AUTH_MFA_UNAVAILABLE',
        metadata: { step: 'mfa', reason: 'mfa_unavailable' },
      });
      throw new AppException('AUTH_MFA_UNAVAILABLE');
    }

    const next = requirement === 'challenge' ? 'mfa' : 'mfaEnroll';
    await this.oidc.saveMfaPending(
      uid,
      {
        accountId: oidcAccountId,
        firstFactor: 'pwd',
        next,
        attempts: 0,
        ...(enroll && { enroll: enroll.id }),
      },
      MFA_PENDING_TTL_SECONDS,
    );
    if (next === 'mfaEnroll') {
      // 政策要求而還沒有任何因子：一定要設定一個（不能略過），可以選任何可用的方式
      const methods = await this.mfa.availableMethods(store);
      return { next, methods: methods.map(methodInfoOf), optional: false };
    }
    return { next, ...(await this.challengeOptions(store, stored)) };
  }

  /** 互動頁要列出的因子（只有目前可用的方式）與備用碼。 */
  private async challengeOptions(
    store: MfaAccountStore,
    stored: MfaStoredAccount,
  ): Promise<Omit<SsoMfaChallengeNextDto, 'next'>> {
    const [factors, methods, recoveryCodes] = await Promise.all([
      store.repo.listFactors(stored.account.id),
      this.mfa.availableMethods(store),
      store.repo.countRecoveryCodes(stored.account.id),
    ]);
    const available = new Set(methods.map((method) => method.definition.id));
    return {
      factors: factors
        .filter((factor) => factor.status === 'active' && available.has(factor.method))
        .map((factor) => this.mfa.factorDto(factor, stored.account, available)),
      recoveryAvailable: recoveryCodes > 0,
    };
  }

  // ── 互動的端點 ─────────────────────────────────────────

  /** `challenge = 'server'` 的因子（Email）：發出驗證碼。 */
  challenge(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    dto: MfaLoginChallengeDto,
  ): Promise<MfaChallengeInfoDto> {
    return this.withPending(req, res, uid, 'mfa', async ({ store, stored }) => {
      const factor = await store.repo.findFactor(stored.account.id, dto.factorId);
      if (!factor || factor.status !== 'active') throw new AppException('MFA_FACTOR_NOT_FOUND');
      return this.mfa.resendChallenge(store.realm, stored.account.id, factor.id, 'login', uid);
    });
  }

  /** 驗證第二步；成功時完成互動，回傳 resume 網址。 */
  verify(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    dto: MfaLoginVerifyDto,
  ): Promise<MfaLoginVerifyResultDto> {
    return this.withPending(req, res, uid, 'mfa', async ({ pending, store, stored }) => {
      const ipPrefix = ipPrefixOf(getRequestContext()?.ip);
      const scope = store.throttleScope();
      // 漸進延遲：沿用密碼的計數鍵（租戶 × email × IP 前綴），與密碼錯誤累計在同一個計數（§4.2）
      await this.loginThrottle.assertAllowed(scope, stored.account.email, ipPrefix);

      const result = await this.check(store, stored, uid, dto);
      if (!result.ok) {
        await this.loginThrottle.recordFailure(scope, stored.account.email, ipPrefix);
        await store.recordLoginFailure(stored, ipPrefix, {
          step: 'mfa',
          method: result.method,
          mfaReason: result.reason,
        });
        const attempts = (await this.oidc.incrementMfaPendingAttempts(uid)) ?? Infinity;
        if (attempts >= MFA_PENDING_MAX_ATTEMPTS) {
          await this.oidc.destroyMfaPending(uid);
          throw new AppException('AUTH_MFA_TOO_MANY_ATTEMPTS');
        }
        throw new AppException(result.code, {
          attemptsRemaining: MFA_PENDING_MAX_ATTEMPTS - attempts,
        });
      }

      const amr = ['pwd', 'mfa', result.amr];
      // 產品要求新增驗證方式（§7.1）：通過第二步之後先設定，設定完（或略過）才完成登入
      const enroll = pending.enroll ? await this.requestedEnrollment(store, pending.enroll) : null;
      if (enroll) {
        const advanced = await this.oidc.advanceMfaPending(uid, {
          ...pending,
          next: 'mfaEnroll',
          attempts: 0,
          optional: true,
          amr,
        });
        if (!advanced) throw new AppException('AUTH_MFA_PENDING_INVALID');
        await this.loginThrottle.reset(scope, stored.account.email, ipPrefix);
        return { next: 'mfaEnroll', methods: [enroll], optional: true };
      }

      // 條件式消耗：兩個併發的驗證只有一個能完成互動
      if (!(await this.oidc.consumeMfaPending(uid)))
        throw new AppException('AUTH_MFA_PENDING_INVALID');
      await this.loginThrottle.reset(scope, stored.account.email, ipPrefix);
      await store.completeLogin(stored, { amr, mfaMethod: result.method });
      const redirectTo = await this.oidc.finishInteraction(req, res, {
        login: { accountId: pending.accountId, amr },
      });
      return { redirectTo };
    });
  }

  /** 必須啟用而還沒有因子（§4.1 第 2 步）：在互動中開始設定。 */
  startEnrollment(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    dto: StartMfaEnrollmentDto,
  ): Promise<MfaEnrollmentDto> {
    return this.withPending(req, res, uid, 'mfaEnroll', ({ pending, store, stored }) => {
      // 產品要求的設定只能設定那一種方式（不是政策要求，不讓這條路變成「通過密碼就能綁任何方式」以外的入口）
      if (pending.optional && dto.method !== pending.enroll) {
        throw new AppException('MFA_METHOD_DISABLED', { method: dto.method });
      }
      return this.mfa.startEnrollment(store.realm, stored.account.id, dto.method, uid, dto.input);
    });
  }

  /** 產品要求的設定（§7.1）可以略過：照常完成登入。政策要求的首次設定不能略過。 */
  skipEnrollment(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
  ): Promise<{ redirectTo: string }> {
    return this.withPending(req, res, uid, 'mfaEnroll', async ({ pending, store, stored }) => {
      if (!pending.optional) throw new AppException('AUTH_MFA_ENROLL_REQUIRED');
      if (!(await this.oidc.consumeMfaPending(uid)))
        throw new AppException('AUTH_MFA_PENDING_INVALID');
      const amr = pending.amr ?? ['pwd'];
      const mfaMethod = amr.length > 1 ? amr.at(-1) : undefined;
      await store.completeLogin(stored, { amr, ...(mfaMethod && { mfaMethod }) });
      const redirectTo = await this.oidc.finishInteraction(req, res, {
        login: { accountId: pending.accountId, amr },
      });
      return { redirectTo };
    });
  }

  /** 重寄設定中的 challenge（Email）。 */
  resendEnrollment(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    factorId: string,
  ): Promise<MfaChallengeInfoDto> {
    return this.withPending(req, res, uid, 'mfaEnroll', ({ store, stored }) =>
      this.mfa.resendChallenge(store.realm, stored.account.id, factorId, 'enroll', uid),
    );
  }

  /**
   * 確認互動中的首次設定：因子改 active、產生備用碼，然後完成互動。頁面先顯示備用碼，使用者確認已保存後才頂層跳轉。
   * 錯誤的碼照第二步的失敗計算（這個人只通過了密碼）。
   */
  confirmEnrollment(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    factorId: string,
    dto: ConfirmMfaEnrollmentDto,
  ): Promise<{ recoveryCodes: string[]; redirectTo: string }> {
    return this.withPending(req, res, uid, 'mfaEnroll', async ({ pending, store, stored }) => {
      const ipPrefix = ipPrefixOf(getRequestContext()?.ip);
      const scope = store.throttleScope();
      await this.loginThrottle.assertAllowed(scope, stored.account.email, ipPrefix);
      let result;
      try {
        result = await this.mfa.confirmEnrollment(store.realm, stored.account.id, factorId, dto, {
          interactionUid: uid,
        });
      } catch (error) {
        if (
          error instanceof AppException &&
          (error.code === 'AUTH_MFA_INVALID_CODE' || error.code === 'AUTH_MFA_CHALLENGE_EXPIRED')
        ) {
          await this.loginThrottle.recordFailure(scope, stored.account.email, ipPrefix);
          await store.recordLoginFailure(stored, ipPrefix, {
            step: 'mfaEnroll',
            mfaReason: error.code,
          });
          const attempts = (await this.oidc.incrementMfaPendingAttempts(uid)) ?? Infinity;
          if (attempts >= MFA_PENDING_MAX_ATTEMPTS) {
            await this.oidc.destroyMfaPending(uid);
            throw new AppException('AUTH_MFA_TOO_MANY_ATTEMPTS');
          }
        }
        throw error;
      }
      if (!(await this.oidc.consumeMfaPending(uid)))
        throw new AppException('AUTH_MFA_PENDING_INVALID');
      await this.loginThrottle.reset(scope, stored.account.email, ipPrefix);
      const method = result.factor.method;
      // 先通過第二步再設定的（§7.1）以第二步的方式為準；首次設定以新設定的方式為準
      const amr =
        pending.amr && pending.amr.length > 1
          ? pending.amr
          : ['pwd', 'mfa', this.mfa.amrOf(method)];
      await store.completeLogin(stored, { amr, mfaMethod: method });
      const redirectTo = await this.oidc.finishInteraction(req, res, {
        login: { accountId: pending.accountId, amr },
      });
      return { recoveryCodes: result.recoveryCodes ?? [], redirectTo };
    });
  }

  // ── 內部 ───────────────────────────────────────────────

  /** 產品要求新增的方式現在能不能設定：要是這個帳號可用的方式、而且還沒到數量上限。 */
  private async requestedEnrollment(
    store: MfaAccountStore,
    methodId: string,
  ): Promise<ReturnType<typeof methodInfoOf> | null> {
    const method = (await this.mfa.availableMethods(store)).find(
      (candidate) => candidate.definition.id === methodId,
    );
    return method ? methodInfoOf(method) : null;
  }

  /** 驗證因子或備用碼；回傳失敗原因（給計數與錯誤碼）或成功的方式。 */
  private async check(
    store: MfaAccountStore,
    stored: MfaStoredAccount,
    uid: string,
    dto: MfaLoginVerifyDto,
  ): Promise<
    | { ok: true; method: string; amr: string }
    | { ok: false; method: string; reason: string; code: ErrorCode }
  > {
    if (dto.factorId === MFA_RECOVERY_METHOD) {
      const payload = RecoveryCodePayloadSchema.safeParse(dto.payload);
      const ok =
        payload.success &&
        (await this.mfa.verifyRecoveryCode(store, stored.account.id, payload.data));
      if (!ok)
        return {
          ok: false,
          method: MFA_RECOVERY_METHOD,
          reason: 'invalid',
          code: 'AUTH_MFA_INVALID_CODE',
        };
      const remaining = await store.repo.countRecoveryCodes(stored.account.id);
      await store.audit({
        kind: 'recoveryUse',
        target: stored.account,
        metadata: { remaining, interactionUid: uid },
      });
      await store.transaction((tx) =>
        this.mfa.afterSecurityChange(store, stored.account, 'recoveryCodeUsed', tx),
      );
      return { ok: true, method: MFA_RECOVERY_METHOD, amr: 'mfa' };
    }

    const factor = await store.repo.findFactor(stored.account.id, dto.factorId);
    if (!factor || factor.status !== 'active') throw new AppException('MFA_FACTOR_NOT_FOUND');
    // 方式被關掉的因子不能用（§4.1：只有可用的方式算數）
    await this.mfa.requireAvailableMethod(store, factor.method);
    const outcome = await this.mfa.verifyFactor(
      store,
      stored,
      factor,
      dto.challengeId,
      dto.payload,
      'login',
    );
    if (!outcome.ok)
      return { ok: false, method: factor.method, reason: outcome.reason, code: outcome.code };
    return { ok: true, method: factor.method, amr: outcome.method.definition.amr };
  }

  /**
   * 確認互動與它的 `MfaPending`，在帳號的脈絡裡執行 `fn`：互動 cookie 必須屬於這個 uid、`MfaPending` 必須屬於
   * 這個互動要登入的租戶（或平台）、帳號仍可登入。任何一項不符就作廢第二步，要從密碼重新開始。
   */
  private async withPending<T>(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    next: MfaPending['next'],
    fn: (ctx: PendingContext) => Promise<T>,
  ): Promise<T> {
    const summary = await this.oidc.interaction(req, res, uid);
    if (!summary) throw new AppException('AUTH_SSO_INTERACTION_INVALID');
    const pending = await this.oidc.findMfaPending(uid);
    const account = parseAccountId(pending?.accountId);
    const sameRealm =
      account?.realm === 'tenant'
        ? summary.tenant?.id === account.tenantId
        : account?.realm === 'platform' && summary.tenant === null;
    if (!pending || !account || !sameRealm || pending.next !== next) {
      throw new AppException('AUTH_MFA_PENDING_INVALID');
    }

    const run = async (): Promise<T> => {
      const store = this.mfa.store(account.realm);
      const stored = await store.findAccount(
        account.realm === 'tenant' ? account.userId : account.adminId,
      );
      if (!stored || !stored.active || stored.locked) {
        await this.oidc.destroyMfaPending(uid);
        throw new AppException('AUTH_MFA_PENDING_INVALID');
      }
      return fn({ pending, store, stored });
    };
    return account.realm === 'tenant' ? this.tenancy.run(account.tenantId, run) : run();
  }
}
