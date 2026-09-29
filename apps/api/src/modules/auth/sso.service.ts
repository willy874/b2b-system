import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { AppException } from '@/core/errors';
import { AuditService } from '@/modules/audit-log/audit.service';
import {
  OidcProviderService,
  OidcRedeemError,
} from '@/modules/oidc-provider/oidc-provider.service';
import { UserService } from '@/modules/user/user.service';

import { AuthService } from './auth.service';
import type { IssuedSession, RequestMeta } from './auth.service';
import type { LoginDto, SsoCallbackDto, SsoInteractionDto, SsoRedirectDto } from './dto/auth.dto';

/**
 * SSO 的兩端（docs/adr/0019-sso-identity-platform.md）：
 * - **IdP 的登入互動**（apps/auth 的 `/interaction/:uid` 呼叫）：驗帳密，完成互動後回傳 resume 網址，
 *   由瀏覽器頂層跳轉回 provider，provider 再帶授權碼跳回產品。
 * - **產品的 BFF**（產品自己 origin 的 `/api/auth/sso/callback`）：兌換授權碼、發 ADR-0004 的 app session（D3）。
 * 服務之間只以頂層跳轉溝通，不用跨域 cookie（D6）。
 */
@Injectable()
export class SsoService implements OnModuleInit {
  constructor(
    private readonly auth: AuthService,
    private readonly oidc: OidcProviderService,
    private readonly users: UserService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // 第三方 RP 走 provider 自己的 end-session 時，也撤銷同一個 IdP session 的 app session
    this.oidc.onSessionEnded((sessionUid) => void this.auth.endIdpSession(sessionUid));
  }

  // ── IdP 的登入互動 ───────────────────────────────────────

  async interaction(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
  ): Promise<SsoInteractionDto> {
    const summary = await this.oidc.interaction(req, res, uid);
    if (!summary) throw new AppException('AUTH_SSO_INTERACTION_INVALID');
    return summary;
  }

  /** 密碼登入：與 `POST /auth/login` 同一套檢查（鎖定、狀態、稽核），通過後完成互動。 */
  async login(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    dto: LoginDto,
  ): Promise<SsoRedirectDto> {
    await this.interaction(req, res, uid);
    const user = await this.auth.verifyCredentials(dto);
    const redirectTo = await this.oidc.finishInteraction(req, res, {
      login: { accountId: user.id },
    });
    return { redirectTo };
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

  async callback(dto: SsoCallbackDto, meta: RequestMeta): Promise<IssuedSession> {
    let redeemed;
    try {
      redeemed = await this.oidc.redeemAuthorizationCode(dto);
    } catch (error) {
      if (error instanceof OidcRedeemError) {
        await this.audit.recordSafely({
          action: 'auth.sso_login.failure',
          resourceType: 'auth',
          result: 'failure',
          errorCode: 'AUTH_SSO_CODE_INVALID',
          metadata: { clientId: dto.clientId, reason: error.reason },
        });
        throw new AppException('AUTH_SSO_CODE_INVALID');
      }
      throw error;
    }

    // IdP 登入到兌換之間帳號可能被停用
    const user = await this.users.findAccountById(redeemed.accountId);
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
}
