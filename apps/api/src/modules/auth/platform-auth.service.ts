import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { currentTenant } from '@/core/tenant';
import type { PlatformAdminRow } from '@/db/platform/schema';
import { PLATFORM_ROLE_PERMISSIONS } from '@/db/seeds/platform-permissions';
import { secondsUntil } from '@/modules/credential/refresh-rotation';
import type { RequestMeta } from '@/modules/credential/refresh-rotation';
import { parseAccountId } from '@/modules/oidc-provider/oidc-account';
import {
  OidcProviderService,
  OidcRedeemError,
} from '@/modules/oidc-provider/oidc-provider.service';
import { PlatformAccountService } from '@/modules/platform-admin/platform-account.service';
import { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';
import { PlatformRefreshTokenService } from '@/modules/platform-admin/platform-refresh-token.service';

import type { IssuedSession } from './auth.service';
import type {
  ChangePasswordDto,
  PlatformProfileDto,
  ResetPasswordDto,
  SetupDto,
  SsoCallbackDto,
  UpdatePlatformProfileDto,
} from './dto/auth.dto';

/**
 * 平台管理者在 apps/auth 的 app session（docs/architecture/05-tenancy.md §10.2 D5）：
 * 規則與租戶的 app session 相同（docs/architecture/backend/04-auth.md §10：5 分鐘 access token ＋ 輪替式 refresh cookie、docs/architecture/04-sso.md §12 的 BFF 與單一登出），
 * 資料在平台 DB。只在 apps/auth 的網域提供：租戶網域上一律 `PLATFORM_ONLY`。
 *
 * access token 帶 `realm: 'platform'`、不帶 `tid`：`AccessTokenVerifier` 在沒有租戶的網域只接受這種 token。
 */
@Injectable()
export class PlatformAuthService implements OnModuleInit {
  private readonly logger = new Logger(PlatformAuthService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    private readonly refreshTokens: PlatformRefreshTokenService,
    private readonly admins: PlatformAdminService,
    private readonly audit: PlatformAuditService,
    private readonly oidc: OidcProviderService,
    private readonly accounts: PlatformAccountService,
  ) {}

  onModuleInit(): void {
    // 第三方 RP 走 provider 的 end-session：平台管理者的 IdP session 由這裡撤銷
    this.oidc.onSessionEnded((sessionUid, account) => {
      if (account?.realm !== 'platform') return;
      // 事件監聽器裡的非同步錯誤沒有人接：一定要自己收
      this.endIdpSession(sessionUid).catch((error: unknown) =>
        this.logger.warn({ err: error }, '結束 IdP session 時無法撤銷平台管理者的 app session'),
      );
    });
  }

  /** BFF：授權碼的帳號必須是平台管理者（D10 的平台版）。 */
  async ssoCallback(dto: SsoCallbackDto, meta: RequestMeta): Promise<IssuedSession> {
    this.assertPlatformHost();
    let redeemed;
    try {
      redeemed = await this.oidc.redeemAuthorizationCode(dto);
    } catch (error) {
      if (!(error instanceof OidcRedeemError)) throw error;
      await this.recordRedeemFailure(dto.clientId, error.reason);
      throw new AppException('AUTH_SSO_CODE_INVALID');
    }
    const account = parseAccountId(redeemed.accountId);
    if (account?.realm !== 'platform') {
      await this.recordRedeemFailure(dto.clientId, 'realm_mismatch');
      throw new AppException('AUTH_SSO_CODE_INVALID');
    }
    // IdP 登入到兌換之間帳號可能被停用
    const admin = await this.admins.findById(account.adminId);
    if (!admin) throw new AppException('AUTH_SSO_CODE_INVALID');
    if (admin.status !== 'active') throw new AppException('AUTH_ACCOUNT_DISABLED');

    const session = await this.issueSession(admin, meta, redeemed.clientId, redeemed.sessionUid);
    await this.audit.recordSafely({
      action: 'platformAuth.sso_login',
      resourceType: 'platformAuth',
      resourceId: admin.id,
      actorId: admin.id,
      actorEmail: admin.email,
      metadata: { clientId: redeemed.clientId },
    });
    return session;
  }

  async refresh(rawToken: string, meta: RequestMeta): Promise<IssuedSession> {
    this.assertPlatformHost();
    const { row, subject, raw, expiresAt } = await this.refreshTokens.rotate(rawToken, {
      ttlSeconds: this.config.get('REFRESH_TOKEN_TTL', { infer: true }),
      familyMaxAgeSeconds: this.config.get('REFRESH_FAMILY_MAX_AGE', { infer: true }),
      reuseGraceSeconds: this.config.get('REFRESH_REUSE_GRACE_SECONDS', { infer: true }),
      meta,
      loadSubject: async (adminId) => {
        const admin = await this.admins.findById(adminId);
        if (!admin) throw new AppException('AUTH_REFRESH_INVALID');
        if (admin.status !== 'active') throw new AppException('AUTH_ACCOUNT_DISABLED');
        return admin;
      },
      onReuse: (reused) =>
        this.audit.recordSafely({
          action: 'platformAuth.refresh.reuse_detected',
          resourceType: 'platformAuth',
          resourceId: reused.subjectId,
          result: 'failure',
          actorId: reused.subjectId,
          actorEmail: 'unknown',
          errorCode: 'AUTH_REFRESH_REUSED',
          metadata: { familyId: reused.familyId, severity: 'high' },
        }),
    });
    return {
      ...(await this.signAccessToken(subject, row.idpSessionUid)),
      refreshToken: raw,
      refreshTtlSeconds: secondsUntil(expiresAt),
    };
  }

  /** 登出：撤銷家族；經 SSO 登入的一併結束 IdP session（docs/architecture/04-sso.md §12.2 D5）。 */
  async logout(rawToken: string | undefined, actor: AuthUser): Promise<{ success: true }> {
    this.assertPlatformHost();
    const row = rawToken ? await this.refreshTokens.revokeFamilyOf(rawToken, 'logout') : undefined;
    const idpSessionUid = row?.adminId === actor.id ? row.idpSessionUid : null;
    if (idpSessionUid) await this.endIdpSession(idpSessionUid);
    await this.audit.recordSafely({
      action: 'platformAuth.logout',
      resourceType: 'platformAuth',
      resourceId: actor.id,
      actorId: actor.id,
      actorEmail: actor.email,
      metadata: { singleLogout: Boolean(idpSessionUid) },
    });
    return { success: true };
  }

  async getProfile(actor: AuthUser): Promise<PlatformProfileDto> {
    this.assertPlatformHost();
    const admin = await this.admins.findById(actor.id);
    if (!admin) throw new AppException('AUTH_TOKEN_INVALID');
    return {
      admin: {
        id: admin.id,
        email: admin.email,
        displayName: admin.displayName,
        status: admin.status,
        lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
        role: admin.role,
      },
      // 前端依它決定頁面與按鈕（平台的權限目錄，docs/architecture/05-tenancy.md §10.2 D5）
      permissions: PLATFORM_ROLE_PERMISSIONS[admin.role].toSorted(),
    };
  }

  async updateProfile(dto: UpdatePlatformProfileDto, actor: AuthUser): Promise<PlatformProfileDto> {
    this.assertPlatformHost();
    await this.accounts.updateDisplayName(actor.id, dto.displayName);
    return this.getProfile(actor);
  }

  /** 結束這個人的所有 session（包含這一個）：前端改完就回到登入頁。 */
  async changePassword(dto: ChangePasswordDto, actor: AuthUser): Promise<{ success: true }> {
    this.assertPlatformHost();
    return this.accounts.changePassword(actor.id, dto.currentPassword, dto.newPassword);
  }

  private async endIdpSession(idpSessionUid: string): Promise<void> {
    await this.oidc.destroySession(idpSessionUid);
    await this.refreshTokens.revokeByIdpSession(idpSessionUid, 'sso_logout');
  }

  private async issueSession(
    admin: PlatformAdminRow,
    meta: RequestMeta,
    clientId: string,
    idpSessionUid: string | null,
  ): Promise<IssuedSession> {
    const refreshTtl = this.config.get('REFRESH_TOKEN_TTL', { infer: true });
    const { raw } = await this.refreshTokens.issue({
      adminId: admin.id,
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
      clientId,
      idpSessionUid,
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ip ?? null,
    });
    return {
      ...(await this.signAccessToken(admin, idpSessionUid)),
      refreshToken: raw,
      refreshTtlSeconds: refreshTtl,
    };
  }

  private async signAccessToken(admin: PlatformAdminRow, idpSessionUid: string | null) {
    const expiresIn = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const accessToken = await this.jwt.signAsync(
      {
        sub: admin.id,
        ver: admin.tokenVersion,
        jti: randomUUID(),
        realm: 'platform',
        ...(idpSessionUid && { sid: idpSessionUid }),
      },
      { secret: this.config.get('JWT_SECRET', { infer: true }), expiresIn },
    );
    return { accessToken, tokenType: 'Bearer' as const, expiresIn };
  }

  async verifySetupToken(token: string): Promise<{ valid: boolean; email?: string }> {
    this.assertPlatformHost();
    return this.accounts.verifySetupToken(token);
  }

  async setup(dto: SetupDto): Promise<{ success: true }> {
    this.assertPlatformHost();
    return this.accounts.setup(dto.token, dto.password);
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: true }> {
    this.assertPlatformHost();
    return this.accounts.resetPassword(dto.token, dto.newPassword);
  }

  private assertPlatformHost(): void {
    if (currentTenant()) throw new AppException('PLATFORM_ONLY');
  }

  private async recordRedeemFailure(clientId: string, reason: string): Promise<void> {
    await this.audit.recordSafely({
      action: 'platformAuth.sso_login.failure',
      resourceType: 'platformAuth',
      result: 'failure',
      actorEmail: 'anonymous',
      errorCode: 'AUTH_SSO_CODE_INVALID',
      metadata: { clientId, reason },
    });
  }
}
