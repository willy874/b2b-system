import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { currentTenant } from '@/core/tenant';
import type { PlatformAdminRow } from '@/db/platform/schema';
import { PLATFORM_ROLE_PERMISSIONS } from '@/db/seeds/platform-permissions';
import { parseAccountId } from '@/modules/oidc-provider/oidc-account';
import {
  OidcProviderService,
  OidcRedeemError,
} from '@/modules/oidc-provider/oidc-provider.service';
import { PlatformAccountService } from '@/modules/platform-admin/platform-account.service';
import { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';
import { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import type { IssuedSession, RequestMeta } from './auth.service';
import type {
  PlatformProfileDto,
  ResetPasswordDto,
  SetupDto,
  SsoCallbackDto,
} from './dto/auth.dto';
import { PlatformRefreshTokenRepository } from './platform-refresh-token.repository';
import { rotateRefreshToken } from './refresh-rotation';
import { sha256 } from './token-hash';

/**
 * 平台管理者在 apps/auth 的 app session（docs/adr/0020-physical-tenant-isolation.md D5）：
 * 規則與租戶的 app session 相同（ADR-0004：5 分鐘 access token ＋ 輪替式 refresh cookie、ADR-0019 的 BFF 與單一登出），
 * 資料在平台 DB。只在 apps/auth 的網域提供：租戶網域上一律 `PLATFORM_ONLY`。
 *
 * access token 帶 `realm: 'platform'`、不帶 `tid`：`AccessTokenVerifier` 在沒有租戶的網域只接受這種 token。
 */
@Injectable()
export class PlatformAuthService implements OnModuleInit {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly jwt: JwtService,
    private readonly refreshTokens: PlatformRefreshTokenRepository,
    private readonly admins: PlatformAdminService,
    private readonly audit: PlatformAuditService,
    private readonly oidc: OidcProviderService,
    private readonly accounts: PlatformAccountService,
  ) {}

  onModuleInit(): void {
    // 第三方 RP 走 provider 的 end-session：平台管理者的 IdP session 由這裡撤銷
    this.oidc.onSessionEnded((sessionUid, account) => {
      if (account?.realm === 'platform') void this.endIdpSession(sessionUid);
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
    const refreshTtl = this.config.get('REFRESH_TOKEN_TTL', { infer: true });
    const { row, subject, raw } = await rotateRefreshToken(this.refreshTokens.store, rawToken, {
      ttlSeconds: refreshTtl,
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
      refreshTtlSeconds: refreshTtl,
    };
  }

  /** 登出：撤銷家族；經 SSO 登入的一併結束 IdP session（ADR-0019 D5）。 */
  async logout(rawToken: string | undefined, actor: AuthUser): Promise<{ success: true }> {
    this.assertPlatformHost();
    const row = rawToken ? await this.refreshTokens.findByHash(sha256(rawToken)) : undefined;
    if (row) await this.refreshTokens.revokeFamily(row.familyId, 'logout');
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
      // 前端依它決定頁面與按鈕（平台的權限目錄，ADR-0020 D5）
      permissions: PLATFORM_ROLE_PERMISSIONS[admin.role].toSorted(),
    };
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
      ttlSeconds: refreshTtl,
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
