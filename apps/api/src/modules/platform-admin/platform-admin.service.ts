import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import type { ErrorCode } from '@/core/errors';
import { getRequestContext } from '@/core/http';
import { ipPrefixOf, LoginThrottle } from '@/core/rate-limit';
import type { PlatformAdminRow } from '@/db/platform/schema';
import { PLATFORM_ROLE_PERMISSIONS } from '@/db/seeds/platform-permissions';
import type { PlatformPermissionKey } from '@/db/seeds/platform-permissions';
import { PasswordHasher } from '@/modules/credential/password-hasher';

import { PlatformAdminLoginSourceRepository } from './platform-admin-login-source.repository';
import { PlatformAdminRepository } from './platform-admin.repository';
import { PlatformAuditService } from './platform-audit.service';

/** 平台管理者登入的漸進延遲計數範圍（租戶用租戶 id）。 */
const PLATFORM_THROTTLE_SCOPE = 'platform';

/**
 * 平台管理者的帳號（docs/architecture/05-tenancy.md §10.2 D5、D8）：apps/platform 不帶租戶的登入互動對這裡驗證。
 * 帳密檢查的規則與租戶的 `AuthService.verifyCredentials` 相同（列舉防護、鎖定、狀態、稽核）。
 */
@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly repo: PlatformAdminRepository,
    private readonly audit: PlatformAuditService,
    private readonly config: ConfigService<Env, true>,
    private readonly passwords: PasswordHasher,
    private readonly loginThrottle: LoginThrottle,
    private readonly loginSources: PlatformAdminLoginSourceRepository,
  ) {}

  async verifyCredentials(dto: { email: string; password: string }): Promise<PlatformAdminRow> {
    // 漸進延遲（docs/architecture/backend/04-auth.md §3.4），計數與租戶分開
    const ipPrefix = ipPrefixOf(getRequestContext()?.ip);
    await this.loginThrottle.assertAllowed(PLATFORM_THROTTLE_SCOPE, dto.email, ipPrefix);
    const admin = await this.repo.findByEmail(dto.email);
    // 時序攻擊防護：帳號不存在時也跑一次 argon2
    if (!admin) {
      await this.passwords.verifyAgainstDummy(dto.password);
      await this.loginThrottle.recordFailure(PLATFORM_THROTTLE_SCOPE, dto.email, ipPrefix);
      await this.audit.recordSafely({
        action: 'platformAuth.login.failure',
        resourceType: 'platformAuth',
        result: 'failure',
        actorEmail: dto.email,
        errorCode: 'AUTH_INVALID_CREDENTIALS',
        metadata: { reason: 'admin_not_found' },
      });
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    // 狀態與鎖定在驗證密碼之後才判斷：不知道密碼的人只看得到 AUTH_INVALID_CREDENTIALS（不能藉此列舉帳號）
    const ok = admin.passwordHash
      ? await this.passwords.verify(admin.passwordHash, dto.password)
      : await this.passwords.verifyAgainstDummy(dto.password);
    const lockedUntil =
      admin.lockedUntil && admin.lockedUntil.getTime() > Date.now() ? admin.lockedUntil : null;
    if (!ok) {
      await this.loginThrottle.recordFailure(PLATFORM_THROTTLE_SCOPE, dto.email, ipPrefix);
      // 鎖定中不計數、不延長鎖定；已知來源的錯誤也不累計鎖定（同租戶）
      if (lockedUntil) throw new AppException('AUTH_INVALID_CREDENTIALS');
      if (await this.loginSources.isKnown(admin.id, ipPrefix)) {
        await this.audit.recordSafely({
          action: 'platformAuth.login.failure',
          resourceType: 'platformAuth',
          resourceId: admin.id,
          result: 'failure',
          actorId: admin.id,
          actorEmail: admin.email,
          errorCode: 'AUTH_INVALID_CREDENTIALS',
          metadata: { reason: 'known_source' },
        });
      } else {
        await this.registerFailedAttempt(admin);
      }
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    // 鎖定中連「密碼正確」也不透露（同租戶的 AuthService.verifyCredentials；backend/04-auth.md §3.2）
    if (lockedUntil) {
      await this.recordRejectedLogin(admin, 'locked', 'AUTH_INVALID_CREDENTIALS');
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }
    if (admin.status === 'inactive') {
      await this.recordRejectedLogin(admin, 'disabled', 'AUTH_ACCOUNT_DISABLED');
      throw new AppException('AUTH_ACCOUNT_DISABLED');
    }
    // 由其他平台管理者建立、還沒從啟用信設定密碼
    if (admin.status === 'pending') {
      await this.recordRejectedLogin(admin, 'pending', 'AUTH_ACCOUNT_PENDING');
      throw new AppException('AUTH_ACCOUNT_PENDING');
    }

    // 鎖定期滿後成功登入：解除鎖定
    await this.repo.update(admin.id, {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      status: 'active',
    });
    await this.loginThrottle.reset(PLATFORM_THROTTLE_SCOPE, dto.email, ipPrefix);
    await this.loginSources.remember(admin.id, ipPrefix);
    await this.audit.recordSafely({
      action: 'platformAuth.login.success',
      resourceType: 'platformAuth',
      resourceId: admin.id,
      actorId: admin.id,
      actorEmail: admin.email,
    });
    return { ...admin, status: 'active' };
  }

  /** 可以登入的平台管理者（未刪除、`active`）；否則 undefined。 */
  async findActive(id: string): Promise<PlatformAdminRow | undefined> {
    const admin = await this.repo.findById(id);
    return admin?.status === 'active' ? admin : undefined;
  }

  /** 可以登入的平台管理者的權限（依角色）；不存在或不是 `active` 時是空集合。 */
  async permissionsOf(id: string): Promise<ReadonlySet<PlatformPermissionKey>> {
    const admin = await this.findActive(id);
    return new Set(admin ? PLATFORM_ROLE_PERMISSIONS[admin.role] : []);
  }

  async findById(id: string): Promise<PlatformAdminRow | undefined> {
    return this.repo.findById(id);
  }

  /** 原子遞增失敗次數（併發的錯誤密碼每一次都算數）；上一次鎖定到期後從 1 重新計算。 */
  /** 密碼正確、但不能登入（鎖定中、停用、未啟用）：留一筆失敗的稽核（同租戶的 AuthService.recordRejectedLogin）。 */
  private async recordRejectedLogin(
    admin: PlatformAdminRow,
    reason: 'locked' | 'pending' | 'disabled',
    errorCode: ErrorCode,
  ): Promise<void> {
    await this.audit.recordSafely({
      action: 'platformAuth.login.failure',
      resourceType: 'platformAuth',
      resourceId: admin.id,
      result: 'failure',
      actorId: admin.id,
      actorEmail: admin.email,
      errorCode,
      metadata: { reason, credentialsValid: true },
    });
  }

  private async registerFailedAttempt(admin: PlatformAdminRow): Promise<void> {
    const result = await this.repo.recordFailedLogin(
      admin.id,
      this.config.get('LOGIN_MAX_ATTEMPTS', { infer: true }),
      this.config.get('LOGIN_LOCKOUT_SECONDS', { infer: true }),
    );
    // 並行的另一個失敗剛好鎖上了：這一次不再計數
    if (!result) return;
    const shouldLock = result.lockedUntil !== null;
    const count = result.failedLoginCount;
    await this.audit.recordSafely({
      action: shouldLock ? 'platformAuth.account_locked' : 'platformAuth.login.failure',
      resourceType: 'platformAuth',
      resourceId: admin.id,
      result: 'failure',
      actorId: admin.id,
      actorEmail: admin.email,
      errorCode: shouldLock ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_INVALID_CREDENTIALS',
      metadata: { failedLoginCount: count },
    });
  }
}
