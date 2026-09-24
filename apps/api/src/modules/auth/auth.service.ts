import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AuthUser } from '@/common/types';
import { UserCacheService } from '@/core/cache';
import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { DRIZZLE, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import type { RefreshTokenRow, UserRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { PermissionService } from '@/modules/permission/permission.service';
import { UserService } from '@/modules/user/user.service';

import { AuthTokenService } from './auth-token.service';
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ProfileDto,
  ResetPasswordDto,
  SessionDto,
  SetupDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
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

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    private readonly users: UserService,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly authTokens: AuthTokenService,
    private readonly permissionService: PermissionService,
    private readonly userCache: UserCacheService,
    private readonly audit: AuditService,
  ) {}

  // ── 登入 ────────────────────────────────────────────────

  async login(dto: LoginDto, meta: RequestMeta): Promise<IssuedSession> {
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

    return this.issueSession(user, meta);
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

  private async issueSession(
    user: UserRow,
    meta: RequestMeta,
    familyId?: string,
  ): Promise<IssuedSession> {
    const refreshTtl = this.config.get('REFRESH_TOKEN_TTL', { infer: true });
    const { raw } = await this.refreshTokens.issue({
      userId: user.id,
      familyId,
      ttlSeconds: refreshTtl,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ip ?? null,
    });
    return {
      ...(await this.signAccessToken(user)),
      refreshToken: raw,
      refreshTtlSeconds: refreshTtl,
    };
  }

  private async signAccessToken(user: UserRow): Promise<SessionDto> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, ver: user.tokenVersion, jti: randomUUID() },
      { secret: this.config.get('JWT_SECRET', { infer: true }), expiresIn },
    );
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }

  // ── 續期 ────────────────────────────────────────────────

  async refresh(rawToken: string, meta: RequestMeta): Promise<IssuedSession> {
    const row = await this.refreshTokens.findByHash(sha256(rawToken));

    if (!row) throw new AppException('AUTH_REFRESH_INVALID');
    // 也看整個家族：登出與續期同時提交時，續期新發的那張可能沒被撤銷到
    if (row.revokedAt || (await this.refreshTokens.isFamilyRevoked(row.familyId))) {
      throw new AppException('AUTH_REFRESH_REVOKED');
    }
    if (row.expiresAt.getTime() < Date.now()) throw new AppException('AUTH_REFRESH_EXPIRED');
    if (row.usedAt) return this.rejectReuse(row, meta);

    const user = await this.users.findAccountById(row.userId);
    if (!user || user.deletedAt) throw new AppException('AUTH_REFRESH_INVALID');
    if (user.status !== 'active') throw new AppException('AUTH_ACCOUNT_DISABLED');

    const refreshTtl = this.config.get('REFRESH_TOKEN_TTL', { infer: true });

    // markUsed 與 create 必須同一個交易，否則使用者會被無故登出
    const raw = await withTransaction(this.db, async (tx) => {
      // 條件式標記：同一張 token 的兩個併發請求只有一個搶得到，另一個不能也發出新 token
      if (!(await this.refreshTokens.markUsed(row.id, tx))) return undefined;
      const next = await this.refreshTokens.issue(
        {
          userId: user.id,
          familyId: row.familyId,
          ttlSeconds: refreshTtl,
          userAgent: meta.userAgent ?? null,
          ipAddress: meta.ip ?? null,
        },
        tx,
      );
      return next.raw;
    });

    if (raw === undefined) {
      // 沒搶到：看是被撤銷（例：同時登出）還是被另一個請求用掉
      const latest = await this.refreshTokens.findByHash(row.tokenHash);
      if (latest?.revokedAt) throw new AppException('AUTH_REFRESH_REVOKED');
      return this.rejectReuse(row, meta);
    }

    return {
      ...(await this.signAccessToken(user)),
      refreshToken: raw,
      refreshTtlSeconds: refreshTtl,
    };
  }

  /** 重用偵測：整條家族失效並記錄高嚴重度稽核。 */
  private async rejectReuse(row: RefreshTokenRow, meta: RequestMeta): Promise<never> {
    await this.refreshTokens.revokeFamily(row.familyId, 'reuse_detected');
    await this.audit.recordSafely({
      action: 'auth.refresh.reuse_detected',
      resourceType: 'auth',
      resourceId: row.userId,
      result: 'failure',
      actorId: row.userId,
      errorCode: 'AUTH_REFRESH_REUSED',
      metadata: {
        familyId: row.familyId,
        severity: 'high',
        ip: meta.ip ?? undefined,
        userAgent: meta.userAgent ?? undefined,
      },
    });
    throw new AppException('AUTH_REFRESH_REUSED');
  }

  // ── 登出 ────────────────────────────────────────────────

  async logout(rawToken: string | undefined, actor: AuthUser): Promise<{ success: true }> {
    if (rawToken) {
      const row = await this.refreshTokens.findByHash(sha256(rawToken));
      // 撤銷整條家族，而不只是當前這一條
      if (row) await this.refreshTokens.revokeFamily(row.familyId, 'logout');
    }
    await this.audit.recordSafely({
      action: 'auth.logout',
      resourceType: 'auth',
      resourceId: actor.id,
      actorId: actor.id,
      actorEmail: actor.email,
    });
    return { success: true };
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
    return this.getProfile(actor);
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
    return { success: true };
  }

  // ── 忘記密碼 / 重設 / 啟用 ───────────────────────────────

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ sent: true }> {
    const user = await this.users.findAccountByEmail(dto.email);
    if (user && user.status === 'active') {
      await this.authTokens.issue(user.id, 'password_reset');
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
    return { success: true };
  }

  private hash(password: string): Promise<string> {
    return hashPassword(password, {
      memoryCost: this.config.get('ARGON2_MEMORY_COST', { infer: true }),
      timeCost: this.config.get('ARGON2_TIME_COST', { infer: true }),
    });
  }
}
