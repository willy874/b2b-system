import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { AppException } from '@/core/errors';
import { requireTenant, Tenancy } from '@/core/tenant';
import { AuditService } from '@/modules/audit-log/audit.service';
import type { RequestMeta } from '@/modules/credential/refresh-rotation';
import { MfaLoginService } from '@/modules/mfa/mfa-login.service';
import type { SsoLoginResult } from '@/modules/mfa/mfa-login.service';
import { parseAccountId } from '@/modules/oidc-provider/oidc-account';
import {
  OidcProviderService,
  OidcRedeemError,
} from '@/modules/oidc-provider/oidc-provider.service';
import type {
  InteractionSummary,
  RedeemedCode,
} from '@/modules/oidc-provider/oidc-provider.service';
import { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';
import { UserAccountService } from '@/modules/user/user-account.service';

import { AuthService } from './auth.service';
import type { IssuedSession } from './auth.service';
import type { LoginDto, SsoCallbackDto, SsoInteractionDto, SsoRedirectDto } from './dto/auth.dto';

/**
 * SSO 的兩端（docs/architecture/04-sso.md §12）：
 * - **IdP 的登入互動**（apps/platform 的 `/interaction/:uid` 呼叫）：驗帳密，完成互動後回傳 resume 網址，
 *   由瀏覽器頂層跳轉回 provider，provider 再帶授權碼跳回產品。
 * - **產品的 BFF**（產品自己 origin 的 `/api/auth/sso/callback`）：兌換授權碼、發 docs/architecture/backend/04-auth.md §10 的 app session（D3）。
 * 服務之間只以頂層跳轉溝通，不用跨域 cookie（D6）。
 */
@Injectable()
export class SsoService implements OnModuleInit {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly auth: AuthService,
    private readonly oidc: OidcProviderService,
    private readonly users: UserAccountService,
    private readonly platformAdmins: PlatformAdminService,
    private readonly tenancy: Tenancy,
    private readonly audit: AuditService,
    private readonly mfa: MfaLoginService,
  ) {}

  onModuleInit(): void {
    // 第三方 RP 走 provider 自己的 end-session 時，也撤銷同一個 IdP session 的 app session
    // （租戶帳號在那個租戶裡撤銷；平台管理者的由 PlatformAuthService 處理）
    this.oidc.onSessionEnded((sessionUid, account) => {
      if (account?.realm !== 'tenant') return;
      // 事件監聽器裡的非同步錯誤沒有人接：一定要自己收（否則未處理的 rejection 會讓程序結束）。
      // 租戶已停用或刪除時進不去：它的 session 在停用時已經撤銷（PlatformTenantService），這裡只記錄
      this.tenancy
        .run(account.tenantId, () => this.auth.endIdpSession(sessionUid))
        .catch((error: unknown) =>
          this.logger.warn(
            { err: error, tenantId: account.tenantId },
            '結束 IdP session 時無法撤銷租戶的 app session',
          ),
        );
    });
  }

  // ── IdP 的登入互動 ───────────────────────────────────────

  async interaction(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
  ): Promise<SsoInteractionDto> {
    const { tenant, ...summary } = await this.requireInteraction(req, res, uid);
    return { ...summary, tenant: tenant && { code: tenant.code, name: tenant.name } };
  }

  /**
   * 密碼登入：與 `POST /auth/login` 同一套檢查（鎖定、狀態、稽核）。通過後交給 MFA 判斷：不需要第二步時完成互動、
   * 回傳 resume 網址；需要時回傳下一步（docs/architecture/backend/21-mfa.md §4）。
   * 帶租戶的互動在那個租戶的 DB 驗證；沒有租戶的是平台管理者（docs/architecture/05-tenancy.md §10.2 D8）。
   */
  async login(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    dto: LoginDto,
  ): Promise<SsoLoginResult> {
    const { tenant, mfaEnroll } = await this.requireInteraction(req, res, uid);
    if (tenant) {
      return this.tenancy.run(tenant.id, async () => {
        const user = await this.auth.checkCredentials(dto);
        return this.mfa.afterPassword(req, res, uid, 'tenant', user.id, { enroll: mfaEnroll });
      });
    }
    const admin = await this.platformAdmins.verifyPassword(dto);
    return this.mfa.afterPassword(req, res, uid, 'platform', admin.id);
  }

  private async requireInteraction(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
  ): Promise<InteractionSummary> {
    const summary = await this.oidc.interaction(req, res, uid);
    if (!summary) throw new AppException('AUTH_SSO_INTERACTION_INVALID');
    return summary;
  }

  /** 使用者取消登入：產品收到 `error=access_denied`。 */
  async abort(req: IncomingMessage, res: ServerResponse, uid: string): Promise<SsoRedirectDto> {
    await this.interaction(req, res, uid);
    const redirectTo = await this.oidc.finishInteraction(req, res, {
      error: 'access_denied',
      error_description: 'login cancelled',
    });
    return { redirectTo };
  }

  // ── 產品的 BFF ───────────────────────────────────────────

  /**
   * 租戶網域上的 BFF：授權碼的帳號必須屬於這個網域的租戶，否則視為無效
   * （docs/architecture/05-tenancy.md §10.2 D10：即使 provider 的檢查有漏洞，也換不到別的租戶的 session）。
   */
  async callback(dto: SsoCallbackDto, meta: RequestMeta): Promise<IssuedSession> {
    const tenant = requireTenant();
    const redeemed = await this.redeem(dto);
    const account = parseAccountId(redeemed.accountId);
    if (account?.realm !== 'tenant' || account.tenantId !== tenant.id) {
      await this.recordRedeemFailure(dto.clientId, 'tenant_mismatch');
      throw new AppException('AUTH_SSO_CODE_INVALID');
    }

    // IdP 登入到兌換之間帳號可能被停用
    const user = await this.users.findAccountById(account.userId);
    if (!user || user.deletedAt) throw new AppException('AUTH_SSO_CODE_INVALID');
    if (user.status !== 'active') throw new AppException('AUTH_ACCOUNT_DISABLED');

    const session = await this.auth.issueSession(user, meta, {
      clientId: redeemed.clientId,
      idpSessionUid: redeemed.sessionUid,
    });
    await this.audit.recordSafely({
      action: 'auth.sso_login',
      resourceType: 'auth',
      resourceId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      metadata: { clientId: redeemed.clientId },
    });
    return session;
  }

  /** 兌換授權碼；失敗一律 `AUTH_SSO_CODE_INVALID`（不洩漏哪一項不對）。 */
  private async redeem(dto: SsoCallbackDto): Promise<RedeemedCode> {
    try {
      return await this.oidc.redeemAuthorizationCode(dto);
    } catch (error) {
      if (error instanceof OidcRedeemError) {
        await this.recordRedeemFailure(dto.clientId, error.reason);
        throw new AppException('AUTH_SSO_CODE_INVALID');
      }
      throw error;
    }
  }

  private async recordRedeemFailure(clientId: string, reason: string): Promise<void> {
    await this.audit.recordSafely({
      action: 'auth.sso_login.failure',
      resourceType: 'auth',
      result: 'failure',
      errorCode: 'AUTH_SSO_CODE_INVALID',
      metadata: { clientId, reason },
    });
  }
}
