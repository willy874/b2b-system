import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException, isUniqueViolation } from '@/core/errors';
import type { ErrorCode } from '@/core/errors';
import { Tenancy } from '@/core/tenant';
import type { UserRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { ExternalOidcClient } from '@/modules/identity-provider/external-oidc.client';
import type { ExternalIdentity } from '@/modules/identity-provider/external-oidc.client';
import {
  domainOf,
  IdentityProviderService,
} from '@/modules/identity-provider/identity-provider.service';
import { tenantAccountId } from '@/modules/oidc-provider/oidc-account';
import { OidcProviderService } from '@/modules/oidc-provider/oidc-provider.service';
import type {
  ExternalLoginState,
  InteractionSummary,
} from '@/modules/oidc-provider/oidc-provider.service';
import { MEMBER_SLUG } from '@/modules/permission/permission.constants';
import { isLoginLocked, UserService } from '@/modules/user/user.service';

import type { SsoDiscoveryDto, SsoRedirectDto } from './dto/auth.dto';

/** 在外部 IdP 登入的時間上限：超過就要從頭來。 */
const EXTERNAL_LOGIN_TTL_SECONDS = 10 * 60;

function random(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * 以外部 IdP 登入（docs/adr/0019-sso-identity-platform.md D8–D10）。全部以 **頂層跳轉** 串接（D6）：
 *
 * 1. 互動頁以 email 查出連線（網域導向）→ `start()` 回傳外部 IdP 的授權網址，頁面跳過去
 * 2. 外部 IdP 帶授權碼跳回 **固定** 的 callback（外部 IdP 大多要求 redirect URI 完全相符，不能帶互動 id）
 *    → `callback()` 兌換、驗證 ID token、對應帳號，再跳到互動路徑底下的 `…/external/complete`
 * 3. 那個路徑帶得到互動 cookie → `complete()` 完成互動，provider 接著帶授權碼跳回產品
 *
 * 外部 IdP 連線屬於租戶（docs/adr/0020-physical-tenant-isolation.md D18）：連線與帳號對應都在互動的那個租戶裡；
 * 平台管理者的登入沒有外部 IdP。
 */
@Injectable()
export class ExternalLoginService {
  private readonly logger = new Logger(ExternalLoginService.name);
  private readonly authAppUrl: string;
  /** 瀏覽器看到的 api 開頭（例：`https://auth.example.com/api`）。 */
  private readonly apiBase: string;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly providers: IdentityProviderService,
    private readonly client: ExternalOidcClient,
    private readonly oidc: OidcProviderService,
    private readonly users: UserService,
    private readonly audit: AuditService,
    private readonly tenancy: Tenancy,
    config: ConfigService<Env, true>,
  ) {
    this.authAppUrl = config.get('AUTH_APP_URL', { infer: true });
    const issuer = new URL(config.get('OIDC_ISSUER', { infer: true }));
    this.apiBase = `${issuer.origin}${issuer.pathname.replace(/\/oidc$/, '')}`;
  }

  // ── 1. 網域導向與發起 ─────────────────────────────────────

  async discover(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    email: string,
  ): Promise<SsoDiscoveryDto> {
    const { tenant } = await this.assertInteraction(req, res, uid);
    if (!tenant) return { provider: null, ssoOnly: false };
    const found = await this.tenancy.run(tenant.id, () => this.providers.discover(email));
    return found
      ? { provider: { id: found.id, name: found.name }, ssoOnly: found.ssoOnly }
      : { provider: null, ssoOnly: false };
  }

  async start(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    providerId: string,
  ): Promise<SsoRedirectDto> {
    const { tenant } = await this.assertInteraction(req, res, uid);
    if (!tenant) throw new AppException('AUTH_SSO_PROVIDER_UNAVAILABLE');
    const login = await this.tenancy.run(tenant.id, () => this.providers.loginConfig(providerId));
    if (!login) throw new AppException('AUTH_SSO_PROVIDER_UNAVAILABLE');

    const state = random();
    const nonce = random();
    const codeVerifier = random();
    let redirectTo: string;
    try {
      redirectTo = await this.client.authorizationUrl(login.config, {
        redirectUri: this.providers.callbackUrl(),
        state,
        nonce,
        codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
      });
    } catch (error) {
      this.logger.warn({ err: error, providerId }, '外部 IdP discovery 失敗');
      throw new AppException('AUTH_SSO_PROVIDER_UNAVAILABLE');
    }
    await this.oidc.saveExternalLogin(
      state,
      { interactionUid: uid, tenantId: tenant.id, providerId, codeVerifier, nonce },
      EXTERNAL_LOGIN_TTL_SECONDS,
    );
    return { redirectTo };
  }

  // ── 2. 外部 IdP 回來 ──────────────────────────────────────

  /**
   * 回傳要讓瀏覽器跳轉的網址，不拋例外：成功 → 互動路徑底下的 complete；
   * 失敗 → apps/auth 的互動頁並帶上錯誤碼（讓使用者改用別的方式登入）。
   */
  async callback(query: { state?: string; error?: string }, rawQuery: string): Promise<string> {
    const pending = query.state ? await this.oidc.findExternalLogin(query.state) : undefined;
    if (!query.state || !pending) return this.errorPage(undefined, 'AUTH_SSO_EXTERNAL_FAILED');
    // 固定的 callback 不在任何租戶網域上：以登入狀態記下的租戶進入
    try {
      return await this.tenancy.run(pending.tenantId, () =>
        this.finishCallback(query, rawQuery, query.state!, pending),
      );
    } catch (error) {
      if (!(error instanceof AppException)) throw error;
      return this.errorPage(pending.interactionUid, 'AUTH_SSO_EXTERNAL_FAILED');
    }
  }

  private async finishCallback(
    query: { error?: string },
    rawQuery: string,
    state: string,
    pending: ExternalLoginState,
  ): Promise<string> {
    const fail = async (code: ErrorCode, reason: string, error?: unknown) => {
      await this.oidc.consumeExternalLogin(state);
      await this.audit.recordSafely({
        action: 'auth.login.failure',
        resourceType: 'auth',
        result: 'failure',
        errorCode: code,
        metadata: { method: 'sso', providerId: pending.providerId, reason },
      });
      if (error) this.logger.warn({ err: error, providerId: pending.providerId }, reason);
      return this.errorPage(pending.interactionUid, code);
    };

    // 使用者在外部 IdP 按了取消，或外部 IdP 拒絕
    if (query.error) return fail('AUTH_SSO_EXTERNAL_FAILED', `external_error:${query.error}`);
    const login = await this.providers.loginConfig(pending.providerId);
    if (!login) return fail('AUTH_SSO_PROVIDER_UNAVAILABLE', 'provider_unavailable');

    let identity: ExternalIdentity;
    try {
      identity = await this.client.exchange(login.config, {
        currentUrl: `${this.providers.callbackUrl()}${rawQuery ? `?${rawQuery}` : ''}`,
        state,
        nonce: pending.nonce,
        codeVerifier: pending.codeVerifier,
      });
    } catch (error) {
      return fail('AUTH_SSO_EXTERNAL_FAILED', 'exchange_failed', error);
    }

    let user: UserRow;
    try {
      user = await this.resolveAccount(login.provider, identity);
    } catch (error) {
      if (error instanceof AppException) return fail(error.code, 'account_resolution');
      throw error;
    }

    await this.users.updateAccount(user.id, { lastLoginAt: new Date() });
    await this.audit.recordSafely({
      action: 'auth.login.success',
      resourceType: 'auth',
      resourceId: user.id,
      actorId: user.id,
      actorEmail: user.email,
      metadata: { method: 'sso', providerId: login.provider.id },
    });
    await this.oidc.saveExternalLogin(
      state,
      { ...pending, accountId: tenantAccountId(pending.tenantId, user.id) },
      EXTERNAL_LOGIN_TTL_SECONDS,
    );
    const ticket = new URLSearchParams({ ticket: state });
    return `${this.apiBase}/oidc-interaction/${pending.interactionUid}/external/complete?${ticket.toString()}`;
  }

  // ── 3. 完成互動 ───────────────────────────────────────────

  /** 回傳 provider 的 resume 網址（頂層跳轉）。票不對、互動不符時拋 `AUTH_SSO_EXTERNAL_FAILED`。 */
  async complete(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    ticket: string,
  ): Promise<string> {
    const pending = await this.oidc.findExternalLogin(ticket);
    if (!pending?.accountId || pending.interactionUid !== uid) {
      throw new AppException('AUTH_SSO_EXTERNAL_FAILED');
    }
    await this.assertInteraction(req, res, uid);
    // 沒搶到：同一張票被併發的請求用掉了
    if (!(await this.oidc.consumeExternalLogin(ticket))) {
      throw new AppException('AUTH_SSO_EXTERNAL_FAILED');
    }
    return this.oidc.finishInteraction(req, res, {
      login: { accountId: pending.accountId, amr: ['ext'] },
    });
  }

  errorPage(uid: string | undefined, code: ErrorCode): string {
    const query = new URLSearchParams({ error: code });
    return uid
      ? `${this.authAppUrl}/interaction/${uid}?${query.toString()}`
      : `${this.authAppUrl}/error?${query.toString()}`;
  }

  // ── 帳號對應（D8、D10）────────────────────────────────────

  /**
   * 1. 已連結的外部身分（`provider ＋ subject`）→ 那個帳號（連結指向已刪除的帳號時刪掉舊連結，往下走）
   * 2. 外部 IdP 回報 **已驗證** 的 email 對上既有帳號 → 連結後登入；但 email 網域必須是這個連線登記的網域，
   *    帳號也不能持有管理用的系統角色，否則拒絕（`AUTH_SSO_LINK_NOT_ALLOWED`，SEC-01）
   * 3. 連線設為 `auto_create`，且 email 網域是這個連線登記的網域 → 建立沒有任何角色的已啟用帳號並連結
   * 4. 否則拒絕
   */
  private async resolveAccount(
    provider: { id: string; unmatchedPolicy: string; domains: { domain: string }[] },
    identity: ExternalIdentity,
  ): Promise<UserRow> {
    const linked = await this.providers.findIdentity(provider.id, identity.subject);
    if (linked) {
      const user = await this.users.findAccountById(linked.userId);
      if (user) {
        this.assertUsable(user);
        await this.providers.touchIdentity(linked.id);
        return user;
      }
      // 連結指向已刪除的帳號（刪除帳號會一併刪連結，這是之前留下的）：
      // `(provider, subject)` 唯一，不刪掉的話同 email 的新帳號永遠連不上（EDGE-06）
      await this.providers.unlinkIdentity(linked.id);
    }

    if (!identity.email || !identity.emailVerified) {
      throw new AppException('AUTH_SSO_ACCOUNT_NOT_FOUND');
    }
    const email = identity.email;
    const existing = await this.users.findAccountByEmail(email);
    if (existing) {
      this.assertUsable(existing);
      await this.assertLinkable(provider, existing);
      await withTransaction(this.db, async (tx) => {
        await this.providers.linkIdentity(
          { userId: existing.id, providerId: provider.id, subject: identity.subject, email },
          tx,
        );
        await this.audit.record(
          {
            action: 'userIdentity.link',
            resourceType: 'user',
            resourceId: existing.id,
            resourceName: existing.email,
            actorId: existing.id,
            actorEmail: existing.email,
            metadata: { providerId: provider.id },
          },
          tx,
        );
      });
      return existing;
    }

    const domain = domainOf(email);
    const ownsDomain = provider.domains.some((item) => item.domain === domain);
    if (provider.unmatchedPolicy !== 'auto_create' || !ownsDomain) {
      throw new AppException('AUTH_SSO_ACCOUNT_NOT_FOUND');
    }
    try {
      const created = await withTransaction(this.db, async (tx) => {
        const user = await this.users.createAccount(
          {
            email,
            displayName: identity.name?.trim() || email.slice(0, email.indexOf('@')),
            status: 'active',
            roleIds: [],
          },
          null,
          tx,
          { source: 'identityProvider', providerId: provider.id },
        );
        await this.providers.linkIdentity(
          { userId: user.id, providerId: provider.id, subject: identity.subject, email },
          tx,
        );
        return user;
      });
      this.users.publishCreated(created.id, []);
      return created;
    } catch (error) {
      // 同一個人在兩個分頁同時第一次登入：後到的那個對上剛建立的帳號
      if (isUniqueViolation(error)) throw new AppException('AUTH_SSO_EXTERNAL_FAILED');
      throw error;
    }
  }

  /**
   * 登入失敗的自動鎖定（`locked_until`）不擋外部 IdP：鎖定是擋猜密碼，外部 IdP 已經驗過本人
   * （docs/architecture/backend/04-auth.md §3.3）。`status = locked` 是舊版鎖定留下的值，視同停用。
   */
  private assertUsable(user: UserRow | undefined): asserts user is UserRow {
    if (!user || user.deletedAt) throw new AppException('AUTH_SSO_ACCOUNT_NOT_FOUND');
    if (user.status === 'pending') throw new AppException('AUTH_ACCOUNT_PENDING');
    if (user.status === 'locked') {
      throw new AppException(isLoginLocked(user) ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_ACCOUNT_DISABLED');
    }
    if (user.status !== 'active') throw new AppException('AUTH_ACCOUNT_DISABLED');
  }

  /**
   * 以 email 自動連結既有帳號的條件（docs/architecture/04-sso.md §3.3、SEC-01）：
   * - email 網域必須登記在 **這個** 連線底下：持 `identityProvider:*` 的人可以自架 IdP、對任何 email 簽出
   *   `email_verified`，不限網域就能連到別人的帳號
   * - 帳號不能持有 `member` 以外的系統角色（super-admin、admin、auditor）：這些帳號被接管的代價太高，
   *   要由本人以密碼登入（或由管理員處理），不自動連結
   */
  private async assertLinkable(
    provider: { id: string; domains: { domain: string }[] },
    user: UserRow,
  ): Promise<void> {
    const domain = domainOf(user.email);
    if (!provider.domains.some((item) => item.domain === domain)) {
      throw new AppException('AUTH_SSO_LINK_NOT_ALLOWED');
    }
    const roles = await this.users.listRoleSummaries(user.id);
    if (roles.some((role) => role.isSystem && role.slug !== MEMBER_SLUG)) {
      throw new AppException('AUTH_SSO_LINK_NOT_ALLOWED');
    }
  }

  private async assertInteraction(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
  ): Promise<InteractionSummary> {
    const summary = await this.oidc.interaction(req, res, uid);
    if (!summary) throw new AppException('AUTH_SSO_INTERACTION_INVALID');
    return summary;
  }
}
