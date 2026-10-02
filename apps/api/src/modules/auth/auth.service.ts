import { randomUUID } from 'node:crypto';

import { ChangeKind, ChangeSource, SessionRevokedReason } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AuthUser } from '@/common/types';
import { UserCacheService } from '@/core/cache';
import type { Env } from '@/core/config';
import type { Database, Transaction } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { FeatureFlagService } from '@/core/feature-flags';
import { JobQueue } from '@/core/jobs';
import { SettingService } from '@/core/settings';
import { requireTenant } from '@/core/tenant';
import type { UserRow } from '@/db/schema';
import { ApprovalService } from '@/modules/approval/approval.service';
import { AuditService } from '@/modules/audit-log/audit.service';
import {
  ACTIVATION_MAIL_JOB,
  FORGOT_PASSWORD_THROTTLE_SECONDS,
  PASSWORD_RESET_MAIL_JOB,
} from '@/modules/credential/auth-mail.constants';
import { AuthTokenService } from '@/modules/credential/auth-token.service';
import {
  LOGIN_LOCKOUT_SECONDS_SETTING,
  LOGIN_MAX_ATTEMPTS_SETTING,
  PASSWORD_MIN_LENGTH_SETTING,
  REGISTRATION_ENABLED_SETTING,
} from '@/modules/credential/auth.settings';
import type { Argon2Options } from '@/modules/credential/password';
import {
  containsContext,
  emailContext,
  hashPassword,
  verifyAgainstDummy,
  verifyPassword,
} from '@/modules/credential/password';
import { secondsUntil } from '@/modules/credential/refresh-rotation';
import type { RequestMeta } from '@/modules/credential/refresh-rotation';
import { RefreshTokenService } from '@/modules/credential/refresh-token.service';
import { IdentityProviderService } from '@/modules/identity-provider/identity-provider.service';
import { OidcProviderService } from '@/modules/oidc-provider/oidc-provider.service';
import { PermissionService } from '@/modules/permission/permission.service';
import { userRegistrationRequest } from '@/modules/user/user-registration.approval';
import { isLoginLocked, UserService, userUpdated } from '@/modules/user/user.service';

import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ProfileDto,
  RegisterDto,
  ResetPasswordDto,
  SessionDto,
  SetupDto,
  UpdateProfileDto,
} from './dto/auth.dto';

export interface IssuedSession extends SessionDto {
  refreshToken: string;
  refreshTtlSeconds: number;
}

/** 經 SSO 發出的 app session 帶的來源（docs/architecture/04-sso.md §12.2 D4）。 */
export interface SsoOrigin {
  clientId: string;
  idpSessionUid: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    private readonly users: UserService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly authTokens: AuthTokenService,
    private readonly permissionService: PermissionService,
    private readonly userCache: UserCacheService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly approvals: ApprovalService,
    private readonly jobs: JobQueue,
    private readonly oidc: OidcProviderService,
    private readonly identityProviders: IdentityProviderService,
    private readonly settings: SettingService,
    private readonly flags: FeatureFlagService,
  ) {}

  // ── 登入 ────────────────────────────────────────────────

  async login(dto: LoginDto, meta: RequestMeta): Promise<IssuedSession> {
    // 直接登入在 production 預設關閉：等同不存在（docs/architecture/06-external-api.md §9.2 D15）
    if (!this.directLoginEnabled()) throw new AppException('NOT_FOUND');
    const user = await this.verifyCredentials(dto);
    return this.issueSession(user, meta);
  }

  /** `DIRECT_LOGIN_ENABLED`；沒設定時 production 關閉、其他環境開啟。 */
  private directLoginEnabled(): boolean {
    return (
      this.config.get('DIRECT_LOGIN_ENABLED', { infer: true }) ??
      this.config.get('NODE_ENV', { infer: true }) !== 'production'
    );
  }

  /**
   * 帳密檢查：列舉防護、鎖定、狀態、失敗計數與稽核。密碼直接登入與 IdP 的登入互動共用
   * （docs/architecture/04-sso.md §12：密碼驗證只有一套）。
   */
  async verifyCredentials(dto: LoginDto): Promise<UserRow> {
    // 只允許 SSO 的網域（docs/architecture/04-sso.md §12.2 D9）：先於查帳號判斷，回應只透露網域設定、不透露帳號是否存在
    if (await this.identityProviders.isSsoOnly(dto.email)) {
      throw new AppException('AUTH_SSO_REQUIRED');
    }
    const user = await this.users.findAccountByEmail(dto.email);

    // 時序攻擊防護：帳號不存在時也跑一次 argon2
    if (!user) {
      await verifyAgainstDummy(dto.password, this.argon2Options());
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
      ? await verifyPassword(user.passwordHash, dto.password)
      : await verifyAgainstDummy(dto.password, this.argon2Options());
    const lockedUntil = isLoginLocked(user) ? user.lockedUntil : null;
    if (!ok) {
      if (lockedUntil) await this.recordLockedAttempt(user);
      else await this.registerFailedAttempt(user);
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

    if (lockedUntil) {
      throw new AppException('AUTH_ACCOUNT_LOCKED', {
        retryAfterSeconds: Math.ceil((lockedUntil.getTime() - Date.now()) / 1000),
      });
    }
    if (user.status === 'pending') throw new AppException('AUTH_ACCOUNT_PENDING');
    if (user.status !== 'active') throw new AppException('AUTH_ACCOUNT_DISABLED');

    // 鎖定到期後的成功登入也在這裡歸零：計數與到期時間一起清掉
    await this.users.updateAccount(user.id, {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    });
    this.userCache.invalidate(user.id);

    await this.audit.recordSafely({
      action: 'auth.login.success',
      resourceType: 'auth',
      resourceId: user.id,
      actorId: user.id,
      actorEmail: user.email,
    });

    return user;
  }

  /**
   * 密碼錯誤（沒有鎖定中）：原子遞增失敗次數，達到上限就鎖定（docs/architecture/backend/04-auth.md §3.3）。
   * 鎖定只寫 `locked_until`、不改 `status`，也 **不** 撤銷既有 session：鎖定是擋猜密碼，
   * 不能讓知道 email 的人藉此把已登入的人踢下線。
   */
  private async registerFailedAttempt(user: UserRow): Promise<void> {
    // 租戶的設定；平台管理者的鎖定仍讀 env（platform-admin.service.ts）
    const maxAttempts = await this.settings.get(LOGIN_MAX_ATTEMPTS_SETTING);
    const lockoutSeconds = await this.settings.get(LOGIN_LOCKOUT_SECONDS_SETTING);
    const result = await this.users.recordFailedLogin(user.id, maxAttempts, lockoutSeconds);
    // undefined：並行的另一個失敗剛好把帳號鎖上了，這一次不再計數
    if (!result) return this.recordLockedAttempt(user);
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
      metadata: { failedLoginCount: result.failedLoginCount },
    });
  }

  /** 鎖定期間的錯誤密碼：不計數、不延長鎖定，只留稽核。 */
  private async recordLockedAttempt(user: UserRow): Promise<void> {
    await this.audit.recordSafely({
      action: 'auth.login.failure',
      resourceType: 'auth',
      resourceId: user.id,
      result: 'failure',
      actorId: user.id,
      actorEmail: user.email,
      errorCode: 'AUTH_INVALID_CREDENTIALS',
      metadata: { reason: 'locked' },
    });
  }

  /** 發一條新的 refresh 家族與 access token；`sso` 有值時記下產品與 IdP session。 */
  async issueSession(user: UserRow, meta: RequestMeta, sso?: SsoOrigin): Promise<IssuedSession> {
    const refreshTtl = this.config.get('REFRESH_TOKEN_TTL', { infer: true });
    const { raw } = await this.refreshTokens.issue({
      userId: user.id,
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
      clientId: sso?.clientId ?? null,
      idpSessionUid: sso?.idpSessionUid ?? null,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ip ?? null,
    });
    return {
      ...(await this.signAccessToken(user, sso?.idpSessionUid ?? null)),
      refreshToken: raw,
      refreshTtlSeconds: refreshTtl,
    };
  }

  /**
   * `sid`：經 SSO 登入時的 IdP session。即時連線依它加入 session 專屬的 room，
   * 單一登出只推給同一個 IdP session 的分頁，不影響同一個人的其他裝置（docs/architecture/04-sso.md §12.2 D5）。
   */
  private async signAccessToken(user: UserRow, idpSessionUid: string | null): Promise<SessionDto> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        ver: user.tokenVersion,
        jti: randomUUID(),
        tid: requireTenant().id,
        ...(idpSessionUid && { sid: idpSessionUid }),
      },
      { secret: this.config.get('JWT_SECRET', { infer: true }), expiresIn },
    );
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }

  // ── 續期 ────────────────────────────────────────────────

  async refresh(rawToken: string, meta: RequestMeta): Promise<IssuedSession> {
    const { row, subject, raw, expiresAt } = await this.refreshTokens.rotate(rawToken, {
      ttlSeconds: this.config.get('REFRESH_TOKEN_TTL', { infer: true }),
      familyMaxAgeSeconds: this.config.get('REFRESH_FAMILY_MAX_AGE', { infer: true }),
      reuseGraceSeconds: this.config.get('REFRESH_REUSE_GRACE_SECONDS', { infer: true }),
      meta,
      loadSubject: async (userId) => {
        const user = await this.users.findAccountById(userId);
        if (!user || user.deletedAt) throw new AppException('AUTH_REFRESH_INVALID');
        if (user.status !== 'active') throw new AppException('AUTH_ACCOUNT_DISABLED');
        return user;
      },
      onReuse: (reused) =>
        this.audit.recordSafely({
          action: 'auth.refresh.reuse_detected',
          resourceType: 'auth',
          resourceId: reused.subjectId,
          result: 'failure',
          actorId: reused.subjectId,
          errorCode: 'AUTH_REFRESH_REUSED',
          metadata: {
            familyId: reused.familyId,
            severity: 'high',
            ip: meta.ip ?? undefined,
            userAgent: meta.userAgent ?? undefined,
          },
        }),
      // 回應遺失後的重送：不是攻擊，只留一般紀錄
      onGraceReplay: (replayed) =>
        this.audit.recordSafely({
          action: 'auth.refresh.replayed',
          resourceType: 'auth',
          resourceId: replayed.subjectId,
          actorId: replayed.subjectId,
          metadata: { familyId: replayed.familyId, ip: meta.ip ?? undefined },
        }),
    });
    return {
      ...(await this.signAccessToken(subject, row.idpSessionUid)),
      refreshToken: raw,
      refreshTtlSeconds: secondsUntil(expiresAt),
    };
  }

  // ── 登出 ────────────────────────────────────────────────

  async logout(rawToken: string | undefined, actor: AuthUser): Promise<{ success: true }> {
    // 撤銷整條家族，而不只是當前這一條
    const row = rawToken ? await this.refreshTokens.revokeFamilyOf(rawToken, 'logout') : undefined;
    // 經 SSO 登入的 session：同一個 IdP session 的所有產品一起登出（docs/architecture/04-sso.md §12.2 D5）
    const idpSessionUid = row?.userId === actor.id ? row.idpSessionUid : null;
    if (idpSessionUid) await this.endIdpSession(idpSessionUid);
    await this.audit.recordSafely({
      action: 'auth.logout',
      resourceType: 'auth',
      resourceId: actor.id,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: row?.clientId
        ? { clientId: row.clientId, singleLogout: Boolean(idpSessionUid) }
        : undefined,
    });
    return { success: true };
  }

  /**
   * 單一登出（docs/architecture/04-sso.md §12.2 D5）：銷毀 IdP session（apps/auth 上的 cookie 之後指向不存在的 session），
   * 撤銷它底下所有產品的 refresh 家族，並推播給同一個 IdP session 的分頁。全部在伺服器端完成，
   * 不需要碰其他 origin 的 cookie；**不** 遞增 `token_version`（那會連其他裝置一起登出）。
   */
  async endIdpSession(idpSessionUid: string): Promise<void> {
    await this.oidc.destroySession(idpSessionUid);
    await this.refreshTokens.revokeByIdpSession(idpSessionUid, 'sso_logout');
    this.events.publish(DomainEvent.SESSIONS_REVOKED, {
      idpSessionUids: [idpSessionUid],
      reason: SessionRevokedReason.SIGNED_OUT,
    });
  }

  // ── 個人資料 ────────────────────────────────────────────

  async getProfile(actor: AuthUser): Promise<ProfileDto> {
    const user = await this.users.findAccountById(actor.id);
    if (!user) throw new AppException('USER_NOT_FOUND');
    const [roles, permissions] = await Promise.all([
      this.users.listRoleSummaries(user.id),
      this.permissionService.getEffectivePermissionKeys(user.id),
    ]);
    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        status: user.status,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
        preferences: { locale: user.locale, timezone: user.timezone },
      },
      roles,
      permissions,
      features: [...requireTenant().features],
      flags: this.flags.enabledKeys(),
    };
  }

  async updateProfile(dto: UpdateProfileDto, actor: AuthUser): Promise<ProfileDto> {
    await this.users.updateAccount(actor.id, {
      displayName: dto.displayName,
      locale: dto.preferences?.locale,
      timezone: dto.preferences?.timezone,
      updatedBy: actor.id,
    });
    this.userCache.invalidate(actor.id);
    const profile = await this.getProfile(actor);
    // 與前端 `selfUpdated(profile)` 宣告的來源相同
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [userUpdated(actor.id, profile.roles)],
      affectedUserIds: [actor.id],
    });
    return profile;
  }

  async changePassword(dto: ChangePasswordDto, actor: AuthUser): Promise<{ success: true }> {
    const user = await this.users.findAccountById(actor.id);
    if (!user?.passwordHash) throw new AppException('AUTH_PASSWORD_MISMATCH');

    const ok = await verifyPassword(user.passwordHash, dto.currentPassword);
    if (!ok) throw new AppException('AUTH_PASSWORD_MISMATCH');
    if (dto.currentPassword === dto.newPassword) throw new AppException('AUTH_PASSWORD_WEAK');
    await this.assertPasswordPolicy(dto.newPassword, 'newPassword', user.email);

    await withTransaction(this.db, async (tx) => {
      await this.users.updateAccount(
        user.id,
        { passwordHash: await this.hash(dto.newPassword), updatedBy: user.id },
        tx,
      );
      await this.users.incrementTokenVersion(user.id, tx);
      await this.refreshTokens.revokeAllForUser(user.id, 'password_reset', tx);
      await this.audit.record(
        {
          action: 'auth.password_change',
          resourceType: 'auth',
          resourceId: user.id,
          actorId: user.id,
          actorEmail: user.email,
          changes: null, // 密碼雜湊絕不進稽核
        },
        tx,
      );
    });

    this.userCache.invalidate(user.id);
    this.publishCredentialChanged(user.id);
    return { success: true };
  }

  /**
   * DTO 的 `PasswordSchema` 已經擋掉 12 以下與常見密碼；這裡處理需要脈絡的部分：
   * 租戶的密碼最短長度（設定 `auth.passwordMinLength`），以及密碼裡不能有 email 的帳號、網域名稱或租戶代碼
   * （docs/architecture/backend/04-auth.md §4.2）。錯誤的形狀與 DTO 驗證相同，前端表單照樣依欄位回填。
   */
  private async assertPasswordPolicy(
    password: string,
    field: string,
    email: string,
  ): Promise<void> {
    const minLength = await this.settings.get(PASSWORD_MIN_LENGTH_SETTING);
    if (password.length < minLength) {
      throw new AppException('VALIDATION_FAILED', {
        fields: { [field]: 'AUTH_PASSWORD_WEAK' },
        minLength,
      });
    }
    if (containsContext(password, [...emailContext(email), requireTenant().code])) {
      throw new AppException('VALIDATION_FAILED', { fields: { [field]: 'AUTH_PASSWORD_WEAK' } });
    }
  }

  // ── 註冊（需審批）────────────────────────────────────────

  /**
   * 送出註冊申請，由管理員在審批頁核准後才建立帳號（docs/rbac/06-approval.md §5）。
   * email 已註冊或已在審核中都回同樣的結果（帳號列舉防護）；雜湊照算，讓回應時間一致。
   * 核准後的帳號是 `pending`，要從寄到這個 email 的啟用信完成設定才能登入（email 所有權驗證）。
   */
  async register(dto: RegisterDto): Promise<{ submitted: true }> {
    if (!(await this.settings.get(REGISTRATION_ENABLED_SETTING))) {
      throw new AppException('AUTH_REGISTRATION_DISABLED');
    }
    // 只允許 SSO 的網域：帳號應該由外部 IdP 建立或連結，不接受以密碼申請（與密碼登入相同的錯誤碼）
    if (await this.identityProviders.isSsoOnly(dto.email)) {
      throw new AppException('AUTH_SSO_REQUIRED');
    }
    await this.assertPasswordPolicy(dto.password, 'password', dto.email);
    const passwordHash = await this.hash(dto.password);
    if (await this.users.findAccountByEmail(dto.email)) return { submitted: true };
    await this.approvals.submit(
      userRegistrationRequest(
        { email: dto.email, displayName: dto.displayName, reason: dto.reason },
        passwordHash,
      ),
    );
    return { submitted: true };
  }

  // ── 忘記密碼 / 重設 / 啟用 ───────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ sent: true }> {
    // 只允許 SSO 的網域不寄重設信（密碼本來就不能用）；回應照舊，不透露帳號是否存在
    const ssoOnly = await this.identityProviders.isSsoOnly(dto.email);
    const user = ssoOnly ? undefined : await this.users.findAccountByEmail(dto.email);
    // 登入失敗鎖定中的人也是 active（鎖定只寫 locked_until）：可以自助重設，重設會順帶解鎖。
    // 還沒啟用的人改寄啟用信——啟用信過期或寄丟時的自助重寄
    const job =
      user?.status === 'active'
        ? PASSWORD_RESET_MAIL_JOB
        : user?.status === 'pending'
          ? ACTIVATION_MAIL_JOB
          : undefined;
    if (user && job) {
      // 入列即回應：寄信慢或 SMTP 暫時失敗都不影響這個請求，也不會從回應時間看出帳號是否存在
      await this.jobs.enqueue(
        job,
        { userId: user.id },
        { throttle: { key: user.id, seconds: FORGOT_PASSWORD_THROTTLE_SECONDS } },
      );
    }
    // 不論如何都回 200（帳號列舉防護）
    return { sent: true };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: true }> {
    const token = await this.authTokens.findUsable(dto.token, 'password_reset');
    if (!token) throw new AppException('AUTH_SETUP_TOKEN_INVALID');
    const user = await this.users.findAccountById(token.userId);
    if (!user) throw new AppException('AUTH_SETUP_TOKEN_INVALID');
    await this.assertPasswordPolicy(dto.newPassword, 'newPassword', user.email);
    const wasLocked = user.status === 'locked' || isLoginLocked(user);
    const passwordHash = await this.hash(dto.newPassword);

    await withTransaction(this.db, async (tx) => {
      // 先搶 token：同一個連結被雙擊或兩個分頁同時送出時，只有一個會成功
      await this.consumeToken(token.id, tx);
      await this.users.updateAccount(
        user.id,
        {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
          // 只有真的改變狀態時才帶：帶了 status 就會遞增樂觀鎖的 version（UserService.updateAccount）
          ...(user.status === 'locked' ? { status: 'active' as const } : {}),
        },
        tx,
      );
      await this.users.incrementTokenVersion(user.id, tx);
      await this.refreshTokens.revokeAllForUser(user.id, 'password_reset', tx);
      await this.audit.record(
        {
          action: 'auth.password_reset',
          resourceType: 'auth',
          resourceId: user.id,
          actorId: user.id,
          actorEmail: user.email,
        },
        tx,
      );
      if (user.status === 'locked') {
        await this.users.emitStatusChanged(user.id, 'active', 'locked', tx);
      }
    });

    this.userCache.invalidate(user.id);
    this.publishCredentialChanged(user.id);
    if (wasLocked) {
      // 重設密碼順帶解鎖：狀態變了
      this.events.publish(DomainEvent.RESOURCE_CHANGED, {
        changes: [userUpdated(user.id, await this.users.listRoleSummaries(user.id))],
        affectedUserIds: [user.id],
      });
    }
    return { success: true };
  }

  async verifySetupToken(token: string): Promise<{ valid: boolean; email?: string }> {
    const row = await this.authTokens.findUsable(token, 'activation');
    if (!row) return { valid: false };
    const user = await this.users.findAccountById(row.userId);
    return user?.status === 'pending' ? { valid: true, email: user.email } : { valid: false };
  }

  async setup(dto: SetupDto): Promise<{ success: true }> {
    const token = await this.authTokens.findUsable(dto.token, 'activation');
    if (!token) throw new AppException('AUTH_SETUP_TOKEN_INVALID');
    const user = await this.users.findAccountById(token.userId);
    // 啟用只把 `pending` 變成 `active`：被停用（或已啟用）的人不能用手上的啟用信把自己改回 active
    if (user?.status !== 'pending') throw new AppException('AUTH_SETUP_TOKEN_INVALID');
    await this.assertPasswordPolicy(dto.password, 'password', user.email);
    const passwordHash = await this.hash(dto.password);

    await withTransaction(this.db, async (tx) => {
      await this.consumeToken(token.id, tx);
      await this.users.updateAccount(user.id, { passwordHash, status: 'active' }, tx);
      await this.audit.record(
        {
          action: 'user.activate',
          resourceType: 'user',
          resourceId: user.id,
          resourceName: user.email,
          actorId: user.id,
          actorEmail: user.email,
        },
        tx,
      );
      await this.users.emitStatusChanged(user.id, 'active', 'pending', tx);
    });

    this.userCache.invalidate(user.id);
    // pending → active：使用者列表的狀態欄
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [userUpdated(user.id, await this.users.listRoleSummaries(user.id))],
      affectedUserIds: [user.id],
    });
    return { success: true };
  }

  /** 在交易內消耗一次性 token；沒搶到（已被併發的請求用掉）就讓整個交易失敗。 */
  private async consumeToken(id: string, tx: Transaction): Promise<void> {
    if (!(await this.authTokens.markUsed(id, tx))) {
      throw new AppException('AUTH_SETUP_TOKEN_INVALID');
    }
  }

  /** 改密碼／重設密碼：`token_version` 已遞增，既有 session 全部作廢。 */
  private publishCredentialChanged(userId: string): void {
    this.events.publish(DomainEvent.SESSIONS_REVOKED, {
      userIds: [userId],
      reason: SessionRevokedReason.TOKEN_STALE,
    });
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.USER_CREDENTIAL, kind: ChangeKind.UPDATE, id: userId }],
    });
  }

  private hash(password: string): Promise<string> {
    return hashPassword(password, this.argon2Options());
  }

  private argon2Options(): Argon2Options {
    return {
      memoryCost: this.config.get('ARGON2_MEMORY_COST', { infer: true }),
      timeCost: this.config.get('ARGON2_TIME_COST', { infer: true }),
    };
  }
}
