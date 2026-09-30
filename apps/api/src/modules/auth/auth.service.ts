import { randomUUID } from 'node:crypto';

import { ChangeKind, ChangeSource, SessionRevokedReason } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AuthUser } from '@/common/types';
import { UserCacheService } from '@/core/cache';
import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { JobQueue } from '@/core/jobs';
import { requireTenant } from '@/core/tenant';
import type { UserRow } from '@/db/schema';
import { ApprovalService } from '@/modules/approval/approval.service';
import { AuditService } from '@/modules/audit-log/audit.service';
import { IdentityProviderService } from '@/modules/identity-provider/identity-provider.service';
import { OidcProviderService } from '@/modules/oidc-provider/oidc-provider.service';
import { PermissionService } from '@/modules/permission/permission.service';
import { userRegistrationRequest } from '@/modules/user/user-registration.approval';
import { UserService, userUpdated } from '@/modules/user/user.service';

import { FORGOT_PASSWORD_THROTTLE_SECONDS, PASSWORD_RESET_MAIL_JOB } from './auth-mail.constants';
import { AuthTokenService } from './auth-token.service';
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
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { rotateRefreshToken } from './refresh-rotation';
import { RefreshTokenRepository } from './refresh-token.repository';
import { sha256 } from './token-hash';

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedSession extends SessionDto {
  refreshToken: string;
  refreshTtlSeconds: number;
}

/** 經 SSO 發出的 app session 帶的來源（docs/adr/0019-sso-identity-platform.md D4）。 */
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
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly authTokens: AuthTokenService,
    private readonly permissionService: PermissionService,
    private readonly userCache: UserCacheService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly approvals: ApprovalService,
    private readonly jobs: JobQueue,
    private readonly oidc: OidcProviderService,
    private readonly identityProviders: IdentityProviderService,
  ) {}

  // ── 登入 ────────────────────────────────────────────────

  async login(dto: LoginDto, meta: RequestMeta): Promise<IssuedSession> {
    const user = await this.verifyCredentials(dto);
    return this.issueSession(user, meta);
  }

  /**
   * 帳密檢查：列舉防護、鎖定、狀態、失敗計數與稽核。密碼直接登入與 IdP 的登入互動共用
   * （docs/adr/0019-sso-identity-platform.md：密碼驗證只有一套）。
   */
  async verifyCredentials(dto: LoginDto): Promise<UserRow> {
    // 只允許 SSO 的網域（ADR-0019 D9）：先於查帳號判斷，回應只透露網域設定、不透露帳號是否存在
    if (await this.identityProviders.isSsoOnly(dto.email)) {
      throw new AppException('AUTH_SSO_REQUIRED');
    }
    const user = await this.users.findAccountByEmail(dto.email);

    // 時序攻擊防護：帳號不存在時也跑一次 argon2
    if (!user) {
      await verifyAgainstDummy(dto.password);
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

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new AppException('AUTH_ACCOUNT_LOCKED', {
        retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
      });
    }

    if (user.status === 'pending') throw new AppException('AUTH_ACCOUNT_PENDING');
    if (user.status !== 'active') throw new AppException('AUTH_ACCOUNT_DISABLED');

    const ok = user.passwordHash ? await verifyPassword(user.passwordHash, dto.password) : false;
    if (!ok) {
      await this.registerFailedAttempt(user);
      throw new AppException('AUTH_INVALID_CREDENTIALS');
    }

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

  private async registerFailedAttempt(user: UserRow): Promise<void> {
    const count = user.failedLoginCount + 1;
    const maxAttempts = this.config.get('LOGIN_MAX_ATTEMPTS', { infer: true });
    const lockoutSeconds = this.config.get('LOGIN_LOCKOUT_SECONDS', { infer: true });
    const shouldLock = count >= maxAttempts;

    await this.users.updateAccount(user.id, {
      failedLoginCount: count,
      lockedUntil: shouldLock ? new Date(Date.now() + lockoutSeconds * 1000) : null,
      status: shouldLock ? 'locked' : user.status,
    });
    this.userCache.invalidate(user.id);
    if (shouldLock && user.status !== 'locked') {
      // 鎖定不遞增 token_version，但 status 已非 active：既有 access token 的下一次 HTTP 請求
      // 本來就會被 AUTH_ACCOUNT_DISABLED 擋下，即時連線也同樣立刻撤銷，不等 token 到期
      this.events.publish(DomainEvent.SESSIONS_REVOKED, {
        userIds: [user.id],
        reason: SessionRevokedReason.ACCOUNT_DISABLED,
      });
      // 狀態欄會出現在使用者列表
      this.events.publish(DomainEvent.RESOURCE_CHANGED, {
        changes: [userUpdated(user.id, await this.users.listRoleSummaries(user.id))],
        affectedUserIds: [user.id],
      });
    }

    await this.audit.recordSafely({
      action: shouldLock ? 'auth.account_locked' : 'auth.login.failure',
      resourceType: 'auth',
      resourceId: user.id,
      result: 'failure',
      actorId: user.id,
      actorEmail: user.email,
      errorCode: shouldLock ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_INVALID_CREDENTIALS',
      metadata: { failedLoginCount: count },
    });
  }

  /** 發一條新的 refresh 家族與 access token；`sso` 有值時記下產品與 IdP session。 */
  async issueSession(user: UserRow, meta: RequestMeta, sso?: SsoOrigin): Promise<IssuedSession> {
    const refreshTtl = this.config.get('REFRESH_TOKEN_TTL', { infer: true });
    const { raw } = await this.refreshTokens.issue({
      userId: user.id,
      ttlSeconds: refreshTtl,
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
   * 單一登出只推給同一個 IdP session 的分頁，不影響同一個人的其他裝置（ADR-0019 D5）。
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
    const refreshTtl = this.config.get('REFRESH_TOKEN_TTL', { infer: true });
    const { row, subject, raw } = await rotateRefreshToken(this.refreshTokens.store, rawToken, {
      ttlSeconds: refreshTtl,
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
    });
    return {
      ...(await this.signAccessToken(subject, row.idpSessionUid)),
      refreshToken: raw,
      refreshTtlSeconds: refreshTtl,
    };
  }

  // ── 登出 ────────────────────────────────────────────────

  /** 撤銷目前租戶的所有 session（平台管理者停用或刪除租戶，docs/adr/0020-physical-tenant-isolation.md D13）。 */
  async revokeAllSessions(): Promise<void> {
    await this.refreshTokens.revokeAll('tenant_disabled');
  }

  async logout(rawToken: string | undefined, actor: AuthUser): Promise<{ success: true }> {
    const row = rawToken ? await this.refreshTokens.findByHash(sha256(rawToken)) : undefined;
    // 撤銷整條家族，而不只是當前這一條
    if (row) await this.refreshTokens.revokeFamily(row.familyId, 'logout');
    // 經 SSO 登入的 session：同一個 IdP session 的所有產品一起登出（ADR-0019 D5）
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
   * 單一登出（ADR-0019 D5）：銷毀 IdP session（apps/auth 上的 cookie 之後指向不存在的 session），
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

  // ── 註冊（需審批）────────────────────────────────────────

  /**
   * 送出註冊申請，由管理員在審批頁核准後才建立帳號（docs/rbac/06-approval.md §5）。
   * email 已註冊或已在審核中都回同樣的結果（帳號列舉防護）；雜湊照算，讓回應時間一致。
   */
  async register(dto: RegisterDto): Promise<{ submitted: true }> {
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
    if (user && user.status === 'active') {
      // 入列即回應：寄信慢或 SMTP 暫時失敗都不影響這個請求，也不會從回應時間看出帳號是否存在
      await this.jobs.enqueue(
        PASSWORD_RESET_MAIL_JOB,
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

    await withTransaction(this.db, async (tx) => {
      await this.users.updateAccount(
        user.id,
        {
          passwordHash: await this.hash(dto.newPassword),
          failedLoginCount: 0,
          lockedUntil: null,
          status: user.status === 'locked' ? 'active' : user.status,
        },
        tx,
      );
      await this.users.incrementTokenVersion(user.id, tx);
      await this.refreshTokens.revokeAllForUser(user.id, 'password_reset', tx);
      await this.authTokens.markUsed(token.id, tx);
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
    });

    this.userCache.invalidate(user.id);
    this.publishCredentialChanged(user.id);
    if (user.status === 'locked') {
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
    return user ? { valid: true, email: user.email } : { valid: false };
  }

  async setup(dto: SetupDto): Promise<{ success: true }> {
    const token = await this.authTokens.findUsable(dto.token, 'activation');
    if (!token) throw new AppException('AUTH_SETUP_TOKEN_INVALID');
    const user = await this.users.findAccountById(token.userId);
    if (!user) throw new AppException('AUTH_SETUP_TOKEN_INVALID');

    await withTransaction(this.db, async (tx) => {
      await this.users.updateAccount(
        user.id,
        { passwordHash: await this.hash(dto.password), status: 'active' },
        tx,
      );
      await this.authTokens.markUsed(token.id, tx);
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
    });

    this.userCache.invalidate(user.id);
    // pending → active：使用者列表的狀態欄
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [userUpdated(user.id, await this.users.listRoleSummaries(user.id))],
      affectedUserIds: [user.id],
    });
    return { success: true };
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
    return hashPassword(password, {
      memoryCost: this.config.get('ARGON2_MEMORY_COST', { infer: true }),
      timeCost: this.config.get('ARGON2_TIME_COST', { infer: true }),
    });
  }
}
