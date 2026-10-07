import { Injectable } from '@nestjs/common';

import { UserCacheService } from '@/core/cache';
import { AppException } from '@/core/errors';
import type { ErrorCode } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { getRequestContext } from '@/core/http';
import { ipPrefixOf, LoginThrottle } from '@/core/rate-limit';
import { SettingService } from '@/core/settings';
import { requireTenant } from '@/core/tenant';
import type { UserRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import {
  LOGIN_LOCKOUT_SECONDS_SETTING,
  LOGIN_MAX_ATTEMPTS_SETTING,
} from '@/modules/credential/auth.settings';
import { LoginSourceService } from '@/modules/credential/login-source.service';
import { PasswordHasher } from '@/modules/credential/password-hasher';

import { UserAccountService } from './user-account.service';
import { isLoginLocked, userUpdated } from './user.service';

/** 登入成功時的附加資訊（docs/architecture/backend/21-mfa.md §12：`auth.login.success` 加上 amr 與方式）。 */
export interface LoginCompletion {
  amr: readonly string[];
  mfaMethod?: string;
}

/**
 * 租戶使用者的密碼登入（docs/architecture/backend/04-auth.md §3）：列舉防護、漸進延遲、鎖定、狀態與稽核。
 * 登入互動（`SsoService`）、直接登入（`AuthService.login`）與 MFA 的第二步（`modules/mfa`）共用，所以放在這裡，
 * 不放在 `AuthModule`（MFA 模組不能依賴 `AuthModule`，否則會形成循環）。
 *
 * 密碼通過 **不等於** 登入成功（docs/architecture/backend/21-mfa.md §4.2）：失敗計數歸零、記住來源、成功的稽核
 * 都在 `completeLogin`，由呼叫端在第二步也通過之後才呼叫——否則知道密碼的人每輸入一次密碼就把第二步的失敗次數歸零，
 * 而且他的 IP 會變成「已知來源」，之後第二步的錯誤不再累計鎖定。
 */
@Injectable()
export class UserLoginService {
  constructor(
    private readonly users: UserAccountService,
    private readonly userCache: UserCacheService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly settings: SettingService,
    private readonly passwords: PasswordHasher,
    private readonly loginThrottle: LoginThrottle,
    private readonly loginSources: LoginSourceService,
  ) {}

  /** 漸進延遲的計數範圍：租戶 id。 */
  throttleScope(): string {
    return requireTenant().id;
  }

  /**
   * 帳密檢查：通過時回傳帳號，**不** 寫入成功的副作用（見類別說明）。失敗時計數、鎖定、稽核後拋錯。
   */
  async verifyPassword(dto: { email: string; password: string }): Promise<UserRow> {
    // 漸進延遲（docs/architecture/backend/04-auth.md §3.4）：在 argon2 之前判斷，被延遲的嘗試不消耗它
    const scope = this.throttleScope();
    const ipPrefix = ipPrefixOf(getRequestContext()?.ip);
    await this.loginThrottle.assertAllowed(scope, dto.email, ipPrefix);
    const user = await this.users.findAccountByEmail(dto.email);

    // 時序攻擊防護：帳號不存在時也跑一次 argon2
    if (!user) {
      await this.passwords.verifyAgainstDummy(dto.password);
      // 未知的 email 一樣計數：延遲不透露帳號是否存在
      await this.loginThrottle.recordFailure(scope, dto.email, ipPrefix);
      await this.audit.recordSafely({
        action: 'auth.login.failure',
        resourceType: 'auth',
        result: 'failure',
        actorEmail: dto.email,
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        metadata: { reason: 'user_not_found' },
      });
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    // 狀態與鎖定都在驗證密碼 **之後** 才判斷：不知道密碼的人一律只看到 AUTH_INVALID_CREDENTIALS，
    // 無法藉「鎖定中／未啟用／停用」的不同錯誤碼列舉帳號（docs/architecture/backend/04-auth.md §3.2）
    const ok = user.passwordHash
      ? await this.passwords.verify(user.passwordHash, dto.password)
      : await this.passwords.verifyAgainstDummy(dto.password);
    if (!ok) {
      await this.loginThrottle.recordFailure(scope, dto.email, ipPrefix);
      await this.recordFailedAttempt(user, ipPrefix);
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    // 鎖定中連「密碼正確」也不透露：回應與密碼錯誤相同，否則鎖定期間猜密碼的人看得到哪一個猜中了。
    // 猜測的節流靠速率限制，鎖定只是輔助（docs/architecture/backend/04-auth.md §3.2、§3.3）
    if (isLoginLocked(user)) {
      await this.recordRejectedLogin(user, 'locked', 'AUTH_INVALID_CREDENTIALS');
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }
    if (user.status === 'pending') {
      await this.recordRejectedLogin(user, 'pending', 'AUTH_ACCOUNT_PENDING');
      throw new AppException('AUTH_ACCOUNT_PENDING');
    }
    if (user.status !== 'active') {
      await this.recordRejectedLogin(user, 'disabled', 'AUTH_ACCOUNT_DISABLED');
      throw new AppException('AUTH_ACCOUNT_DISABLED');
    }
    return user;
  }

  /**
   * 一次失敗的驗證（密碼錯誤，或 MFA 第二步的驗證碼錯誤，docs/architecture/backend/21-mfa.md §4.2）：
   * 鎖定中只留稽核；已知來源（登入成功過的使用者 × IP 前綴）不累計鎖定，只受漸進延遲限制——
   * 知道 email 的人不能從陌生的地方把對方鎖住，對方也還能從平常的地方登入（docs/architecture/backend/04-auth.md §3.4）。
   * 漸進延遲的計數由呼叫端記（它知道計數的鍵）。
   */
  async recordFailedAttempt(
    user: UserRow,
    ipPrefix: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (isLoginLocked(user)) await this.recordLockedAttempt(user, metadata);
    else if (await this.loginSources.isKnown(user.id, ipPrefix)) {
      await this.recordKnownSourceFailure(user, metadata);
    } else await this.registerFailedAttempt(user, metadata);
  }

  /** 第一步與第二步都通過：失敗計數歸零、記住來源、寫成功的稽核。 */
  async completeLogin(
    user: UserRow,
    completion: LoginCompletion = { amr: ['pwd'] },
  ): Promise<void> {
    const scope = this.throttleScope();
    const ipPrefix = ipPrefixOf(getRequestContext()?.ip);
    // 鎖定到期後的成功登入也在這裡歸零：計數與到期時間一起清掉
    await this.users.updateAccount(user.id, {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
    this.userCache.invalidate(user.id);
    await this.loginThrottle.reset(scope, user.email, ipPrefix);
    await this.loginSources.remember(user.id, ipPrefix);

    await this.audit.recordSafely({
      action: 'auth.login.success',
      resourceType: 'auth',
      resourceId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      metadata: {
        amr: [...completion.amr],
        ...(completion.mfaMethod && { mfaMethod: completion.mfaMethod }),
      },
    });
  }

  /** 已知來源的錯誤：不累計鎖定，只留一筆失敗的稽核。 */
  private async recordKnownSourceFailure(
    user: UserRow,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.recordSafely({
      action: 'auth.login.failure',
      resourceType: 'auth',
      resourceId: user.id,
      result: 'failure',
      actorId: user.id,
      actorEmail: user.email,
      errorCode: 'AUTH_INVALID_CREDENTIALS',
      metadata: { reason: 'known_source', ...metadata },
    });
  }

  /**
   * 沒有鎖定中的錯誤：原子遞增失敗次數，達到上限就鎖定（docs/architecture/backend/04-auth.md §3.3）。
   * 鎖定只寫 `locked_until`、不改 `status`，也 **不** 撤銷既有 session：鎖定是擋猜密碼，
   * 不能讓知道 email 的人藉此把已登入的人踢下線。
   */
  private async registerFailedAttempt(
    user: UserRow,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    // 租戶的設定；平台管理者的鎖定仍讀 env（platform-admin.service.ts）
    const maxAttempts = await this.settings.get(LOGIN_MAX_ATTEMPTS_SETTING);
    const lockoutSeconds = await this.settings.get(LOGIN_LOCKOUT_SECONDS_SETTING);
    const result = await this.users.recordFailedLogin(user.id, maxAttempts, lockoutSeconds);
    // undefined：並行的另一個失敗剛好把帳號鎖上了，這一次不再計數
    if (!result) return this.recordLockedAttempt(user, metadata);
    const locked = result.lockedUntil !== null;

    if (locked) {
      // 列表的狀態欄顯示為 locked（`displayStatusOf`）
      this.events.publish(DomainEvent.RESOURCE_CHANGED, {
        changes: [userUpdated(user.id, await this.users.listRoleSummaries(user.id))],
        affectedUserIds: [user.id],
      });
    }

    await this.audit.recordSafely({
      action: locked ? 'auth.account_locked' : 'auth.login.failure',
      resourceType: 'auth',
      resourceId: user.id,
      result: 'failure',
      actorId: user.id,
      actorEmail: user.email,
      errorCode: locked ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_INVALID_CREDENTIALS',
      metadata: { failedLoginCount: result.failedLoginCount, ...metadata },
    });
  }

  /**
   * 密碼正確、但帳號不能登入（鎖定中、未啟用、停用）：寫一筆失敗的稽核。鎖定或停用之後還有人拿 **正確** 的密碼來試，
   * 是憑證外洩的強訊號，要查得到（docs/architecture/backend/04-auth.md §9）。
   */
  private async recordRejectedLogin(
    user: UserRow,
    reason: 'locked' | 'pending' | 'disabled',
    errorCode: ErrorCode,
  ): Promise<void> {
    await this.audit.recordSafely({
      action: 'auth.login.failure',
      resourceType: 'auth',
      resourceId: user.id,
      result: 'failure',
      actorId: user.id,
      actorEmail: user.email,
      errorCode,
      metadata: { reason, credentialsValid: true },
    });
  }

  /** 鎖定期間的錯誤：不計數、不延長鎖定，只留稽核。 */
  private async recordLockedAttempt(
    user: UserRow,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.recordSafely({
      action: 'auth.login.failure',
      resourceType: 'auth',
      resourceId: user.id,
      result: 'failure',
      actorId: user.id,
      actorEmail: user.email,
      errorCode: 'AUTH_INVALID_CREDENTIALS',
      metadata: { reason: 'locked', ...metadata },
    });
  }
}
