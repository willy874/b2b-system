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
import { sha256 } from '@/modules/credential/token-hash';
import { ExternalOidcClient } from '@/modules/identity-provider/external-oidc.client';
import type { ExternalIdentity } from '@/modules/identity-provider/external-oidc.client';
import { ExternalSamlClient } from '@/modules/identity-provider/external-saml.client';
import {
  domainOf,
  IdentityProviderService,
} from '@/modules/identity-provider/identity-provider.service';
import type { ProviderLoginConfig } from '@/modules/identity-provider/identity-provider.service';
import { tenantAccountId } from '@/modules/oidc-provider/oidc-account';
import { OidcProviderService } from '@/modules/oidc-provider/oidc-provider.service';
import type {
  ExternalLoginState,
  InteractionSummary,
} from '@/modules/oidc-provider/oidc-provider.service';
import { MEMBER_SLUG } from '@/modules/permission/permission.constants';
import { UserAccountService } from '@/modules/user/user-account.service';

import type { SsoDiscoveryDto, SsoRedirectDto } from './dto/auth.dto';

/** 在外部 IdP 登入的時間上限：超過就要從頭來。 */
const EXTERNAL_LOGIN_TTL_SECONDS = 10 * 60;

/** 綁定 cookie 的名稱前綴；後面接 `state` 雜湊的前 16 碼，同一個瀏覽器同時開兩個外部登入也互不覆蓋。 */
const BINDING_COOKIE_PREFIX = 'ext_login_';

/** 要設定或清掉的 cookie（形狀相容 Express 的 `res.cookie`）。 */
export interface ExternalLoginCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    /** OIDC 的 callback 是跨站的頂層 GET（Lax 會帶上）；SAML 的 ACS 是跨站的 POST，只有 None 會帶上。 */
    sameSite: 'lax' | 'none';
    path: string;
    maxAge: number;
  };
}

/** SAML 的 ACS 收到的表單（HTTP-POST binding）。 */
export interface SamlAcsForm {
  SAMLResponse?: string;
  RelayState?: string;
}

/** callback 的結果：瀏覽器要跳去哪裡，以及要清掉的綁定 cookie。 */
export interface ExternalCallbackResult {
  location: string;
  clearCookies: Array<{ name: string; path: string }>;
}

/** 記錄失敗、作廢登入狀態，回傳要跳去的錯誤頁。 */
type FailFn = (code: ErrorCode, reason: string, error?: unknown) => Promise<string>;

/** 外部 IdP 驗證通過：外部身分與當下的連線設定（帳號對應要看連線的網域與政策）。 */
interface Identified {
  identity: ExternalIdentity;
  login: ProviderLoginConfig;
}

function random(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * 以外部 IdP 登入（docs/architecture/04-sso.md §12.2 D8–D10）。全部以 **頂層跳轉** 串接（D6）：
 *
 * 1. 互動頁以 email 查出連線（網域導向）→ `start()` 回傳外部 IdP 的授權網址，頁面跳過去
 * 2. 外部 IdP 帶授權碼跳回 **固定** 的 callback（外部 IdP 大多要求 redirect URI 完全相符，不能帶互動 id）
 *    → `callback()` 兌換、驗證 ID token、對應帳號，再跳到互動路徑底下的 `…/external/complete`
 * 3. 那個路徑帶得到互動 cookie → `complete()` 完成互動，provider 接著帶授權碼跳回產品
 *
 * 外部 IdP 連線屬於租戶（docs/architecture/05-tenancy.md §10.2 D18）：連線與帳號對應都在互動的那個租戶裡；
 * 平台管理者的登入沒有外部 IdP。
 */
@Injectable()
export class ExternalLoginService {
  private readonly logger = new Logger(ExternalLoginService.name);
  private readonly platformAppUrl: string;
  /** 瀏覽器看到的 api 開頭（例：`https://auth.example.com/api`）。 */
  private readonly apiBase: string;
  private readonly secureCookies: boolean;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly providers: IdentityProviderService,
    private readonly client: ExternalOidcClient,
    private readonly saml: ExternalSamlClient,
    private readonly oidc: OidcProviderService,
    private readonly users: UserAccountService,
    private readonly audit: AuditService,
    private readonly tenancy: Tenancy,
    config: ConfigService<Env, true>,
  ) {
    this.platformAppUrl = config.get('PLATFORM_APP_URL', { infer: true });
    const issuer = new URL(config.get('OIDC_ISSUER', { infer: true }));
    this.apiBase = `${issuer.origin}${issuer.pathname.replace(/\/oidc$/, '')}`;
    this.secureCookies = config.get('NODE_ENV', { infer: true }) === 'production';
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

  /**
   * 回傳外部 IdP 的授權網址，以及要設在 **這個** 瀏覽器的綁定 cookie：`state` 不綁定瀏覽器的話，
   * 發起者可以讓別人在外部 IdP 完成驗證，再拿那個人的身分完成自己的互動（登入 CSRF；RFC 9700 §4.7）。
   */
  async start(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    providerId: string,
  ): Promise<SsoRedirectDto & { binding: ExternalLoginCookie }> {
    const { tenant } = await this.assertInteraction(req, res, uid);
    if (!tenant) throw new AppException('AUTH_SSO_PROVIDER_UNAVAILABLE');
    const login = await this.tenancy.run(tenant.id, () => this.providers.loginConfig(providerId));
    if (!login) throw new AppException('AUTH_SSO_PROVIDER_UNAVAILABLE');

    const state = random();
    let redirectTo: string;
    let protocolState: { codeVerifier: string; nonce: string; samlRequestId?: string };
    try {
      ({ redirectTo, protocolState } = await this.authorizationRequest(login, state));
    } catch (error) {
      this.logger.warn({ err: error, providerId }, '外部 IdP 的授權請求產生失敗');
      throw new AppException('AUTH_SSO_PROVIDER_UNAVAILABLE');
    }
    const binding = random();
    await this.oidc.saveExternalLogin(
      state,
      {
        interactionUid: uid,
        tenantId: tenant.id,
        providerId,
        protocol: login.protocol,
        ...protocolState,
        bindingHash: sha256(binding),
      },
      EXTERNAL_LOGIN_TTL_SECONDS,
    );
    const saml = login.protocol === 'saml';
    return {
      redirectTo,
      binding: {
        name: this.bindingCookieName(state),
        value: binding,
        options: {
          httpOnly: true,
          // SameSite=None 一定要 Secure（瀏覽器規定；http://localhost 也接受 Secure）
          secure: saml || this.secureCookies,
          // 外部 IdP 跳回 OIDC 的 callback 是跨站的頂層 GET：Lax 會帶上。SAML 的 IdP 以跨站的 POST 送到 ACS：
          // Lax 不會帶上，只能 None；path 只到 ACS，其他請求都不帶
          sameSite: saml ? 'none' : 'lax',
          // 只送到固定的 callback／ACS（瀏覽器看到的路徑，含反向代理的前綴）
          path: this.bindingCookiePath(login.protocol),
          maxAge: EXTERNAL_LOGIN_TTL_SECONDS * 1000,
        },
      },
    };
  }

  /**
   * 依協定產生要跳轉的授權網址與要記下的狀態：OIDC 是 PKCE ＋ nonce（state 在網址上）；
   * SAML 是 AuthnRequest（HTTP-Redirect binding，state 放在 RelayState）與它的 ID。
   */
  private async authorizationRequest(
    login: ProviderLoginConfig,
    state: string,
  ): Promise<{
    redirectTo: string;
    protocolState: { codeVerifier: string; nonce: string; samlRequestId?: string };
  }> {
    if (login.protocol === 'saml') {
      const { url, requestId } = await this.saml.authorizationUrl(login.config, login.sp, {
        relayState: state,
      });
      return {
        redirectTo: url,
        protocolState: { codeVerifier: '', nonce: '', samlRequestId: requestId },
      };
    }
    const nonce = random();
    const codeVerifier = random();
    const redirectTo = await this.client.authorizationUrl(login.config, {
      redirectUri: this.providers.callbackUrl(),
      state,
      nonce,
      codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'),
    });
    return { redirectTo, protocolState: { codeVerifier, nonce } };
  }

  private bindingCookieName(state: string): string {
    return `${BINDING_COOKIE_PREFIX}${sha256(state).slice(0, 16)}`;
  }

  private bindingCookiePath(protocol: ProviderLoginConfig['protocol']): string {
    const url = protocol === 'saml' ? this.providers.samlAcsUrl() : this.providers.callbackUrl();
    return new URL(url).pathname;
  }

  // ── 2. 外部 IdP 回來 ──────────────────────────────────────

  /**
   * 回傳要讓瀏覽器跳轉的網址，不拋例外：成功 → 互動路徑底下的 complete；
   * 失敗 → apps/platform 的互動頁並帶上錯誤碼（讓使用者改用別的方式登入）。綁定 cookie 不論成敗都清掉。
   */
  async callback(
    query: { state?: string; error?: string },
    rawQuery: string,
    cookies: Record<string, string | undefined> = {},
  ): Promise<ExternalCallbackResult> {
    const { state } = query;
    if (!state)
      return { location: this.errorPage(undefined, 'AUTH_SSO_EXTERNAL_FAILED'), clearCookies: [] };
    return this.handleReturn(state, 'oidc', cookies, (pending, fail) =>
      this.exchangeOidc(query, rawQuery, state, pending, fail),
    );
  }

  /**
   * SAML 的 Assertion Consumer Service（HTTP-POST binding，docs/architecture/04-sso.md §3.3.2）：以 RelayState 找回登入狀態，
   * 之後與 OIDC 的 callback 相同（綁定 cookie、帳號對應、ticket）。同樣不拋例外。
   */
  async samlAcs(
    form: SamlAcsForm,
    cookies: Record<string, string | undefined> = {},
  ): Promise<ExternalCallbackResult> {
    const state = form.RelayState;
    if (!state)
      return { location: this.errorPage(undefined, 'AUTH_SSO_EXTERNAL_FAILED'), clearCookies: [] };
    return this.handleReturn(state, 'saml', cookies, (pending, fail) =>
      this.validateSaml(form, pending, fail),
    );
  }

  /**
   * 外部 IdP 回來之後兩種協定共用的部分：找回登入狀態、進入它的租戶、比對綁定 cookie、取得外部身分（依協定）、
   * 對應帳號、換成 ticket 跳到 complete。綁定 cookie 不論成敗都清掉。
   */
  private async handleReturn(
    state: string,
    protocol: ProviderLoginConfig['protocol'],
    cookies: Record<string, string | undefined>,
    identify: (pending: ExternalLoginState, fail: FailFn) => Promise<Identified | string>,
  ): Promise<ExternalCallbackResult> {
    const name = this.bindingCookieName(state);
    const clearCookies = [{ name, path: this.bindingCookiePath(protocol) }];
    const pending = await this.oidc.findExternalLogin(state);
    // 協定不符（拿 SAML 的 RelayState 打 OIDC 的 callback，或反過來）當作找不到
    if (!pending || (pending.protocol ?? 'oidc') !== protocol)
      return { location: this.errorPage(undefined, 'AUTH_SSO_EXTERNAL_FAILED'), clearCookies };
    // 固定的 callback 不在任何租戶網域上：以登入狀態記下的租戶進入
    try {
      const location = await this.tenancy.run(pending.tenantId, () =>
        this.finishReturn(state, pending, cookies[name], identify),
      );
      return { location, clearCookies };
    } catch (error) {
      if (!(error instanceof AppException)) throw error;
      return {
        location: this.errorPage(pending.interactionUid, 'AUTH_SSO_EXTERNAL_FAILED'),
        clearCookies,
      };
    }
  }

  private async finishReturn(
    state: string,
    pending: ExternalLoginState,
    binding: string | undefined,
    identify: (pending: ExternalLoginState, fail: FailFn) => Promise<Identified | string>,
  ): Promise<string> {
    const fail: FailFn = async (code, reason, error) => {
      await this.oidc.consumeExternalLogin(state);
      await this.audit.recordSafely({
        action: 'auth.login.failure',
        resourceType: 'auth',
        result: 'failure',
        errorCode: code,
        metadata: {
          method: 'sso',
          protocol: pending.protocol ?? 'oidc',
          providerId: pending.providerId,
          reason,
        },
      });
      if (error) this.logger.warn({ err: error, providerId: pending.providerId }, reason);
      return this.errorPage(pending.interactionUid, code);
    };

    // 回來的不是發起登入的瀏覽器：在兌換授權碼（驗證 SAML 回應）之前就拒絕，也不寫 accountId
    if (!pending.bindingHash || !binding || sha256(binding) !== pending.bindingHash) {
      return fail('AUTH_SSO_EXTERNAL_FAILED', 'browser_mismatch');
    }
    const identified = await identify(pending, fail);
    if (typeof identified === 'string') return identified;
    const { identity, login } = identified;

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
      metadata: { method: 'sso', protocol: login.protocol, providerId: login.provider.id },
    });
    // 完成互動的 ticket 與 state 脫鉤：state 從一開始就在發起者手上，ticket 只交給通過綁定檢查的這個瀏覽器
    const ticket = random();
    await this.oidc.saveExternalLogin(
      sha256(ticket),
      { ...pending, accountId: tenantAccountId(pending.tenantId, user.id) },
      EXTERNAL_LOGIN_TTL_SECONDS,
    );
    await this.oidc.consumeExternalLogin(state);
    const complete = new URLSearchParams({ ticket });
    return `${this.apiBase}/oidc-interaction/${pending.interactionUid}/external/complete?${complete.toString()}`;
  }

  /** OIDC：兌換授權碼、驗證 ID token。失敗時回傳錯誤頁的網址（`fail` 的結果）。 */
  private async exchangeOidc(
    query: { error?: string },
    rawQuery: string,
    state: string,
    pending: ExternalLoginState,
    fail: FailFn,
  ): Promise<Identified | string> {
    // 使用者在外部 IdP 按了取消，或外部 IdP 拒絕
    if (query.error) return fail('AUTH_SSO_EXTERNAL_FAILED', `external_error:${query.error}`);
    const login = await this.providers.loginConfig(pending.providerId);
    if (login?.protocol !== 'oidc')
      return fail('AUTH_SSO_PROVIDER_UNAVAILABLE', 'provider_unavailable');
    try {
      const identity = await this.client.exchange(login.config, {
        currentUrl: `${this.providers.callbackUrl()}${rawQuery ? `?${rawQuery}` : ''}`,
        state,
        nonce: pending.nonce,
        codeVerifier: pending.codeVerifier,
      });
      return { identity, login };
    } catch (error) {
      return fail('AUTH_SSO_EXTERNAL_FAILED', 'exchange_failed', error);
    }
  }

  /**
   * SAML：驗證回應（簽章、Issuer、Audience、時間、`InResponseTo` 必須是這次的 AuthnRequest）。
   * 同一份回應不能用兩次：RelayState 的登入狀態在成功或失敗時都作廢，`InResponseTo` 也只認那一次的 request。
   */
  private async validateSaml(
    form: SamlAcsForm,
    pending: ExternalLoginState,
    fail: FailFn,
  ): Promise<Identified | string> {
    if (!form.SAMLResponse || !pending.samlRequestId) {
      return fail('AUTH_SSO_EXTERNAL_FAILED', 'saml_response_missing');
    }
    const login = await this.providers.loginConfig(pending.providerId);
    if (login?.protocol !== 'saml')
      return fail('AUTH_SSO_PROVIDER_UNAVAILABLE', 'provider_unavailable');
    try {
      const identity = await this.saml.validate(login.config, login.sp, {
        samlResponse: form.SAMLResponse,
        requestId: pending.samlRequestId,
      });
      return { identity, login };
    } catch (error) {
      return fail('AUTH_SSO_EXTERNAL_FAILED', 'saml_validation_failed', error);
    }
  }

  /**
   * SAML 連線的 SP metadata（給 IdP 匯入）。固定的端點不在租戶網域上，租戶 id 在路徑裡（也是 SP 的 entity ID）。
   * 租戶不存在、不能進入、連線不是 SAML 時一律 `IDENTITY_PROVIDER_NOT_FOUND`（不洩漏是哪一項）。
   */
  async samlMetadata(tenantId: string, providerId: string): Promise<string> {
    try {
      return await this.tenancy.run(tenantId, () =>
        this.providers.serviceProviderMetadata(providerId),
      );
    } catch (error) {
      if (error instanceof AppException) throw new AppException('IDENTITY_PROVIDER_NOT_FOUND');
      throw error;
    }
  }

  // ── 3. 完成互動 ───────────────────────────────────────────

  /** 回傳 provider 的 resume 網址（頂層跳轉）。票不對、互動不符時拋 `AUTH_SSO_EXTERNAL_FAILED`。 */
  async complete(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
    ticket: string,
  ): Promise<string> {
    const key = sha256(ticket);
    const pending = await this.oidc.findExternalLogin(key);
    if (!pending?.accountId || pending.interactionUid !== uid) {
      throw new AppException('AUTH_SSO_EXTERNAL_FAILED');
    }
    await this.assertInteraction(req, res, uid);
    // 沒搶到：同一張票被併發的請求用掉了
    if (!(await this.oidc.consumeExternalLogin(key))) {
      throw new AppException('AUTH_SSO_EXTERNAL_FAILED');
    }
    return this.oidc.finishInteraction(req, res, {
      login: { accountId: pending.accountId, amr: ['ext'] },
    });
  }

  errorPage(uid: string | undefined, code: ErrorCode): string {
    const query = new URLSearchParams({ error: code });
    return uid
      ? `${this.platformAppUrl}/interaction/${uid}?${query.toString()}`
      : `${this.platformAppUrl}/error?${query.toString()}`;
  }

  // ── 帳號對應（D8、D10）────────────────────────────────────

  /**
   * 1. 已連結的外部身分（`provider ＋ subject`）→ 那個帳號（連結指向已刪除的帳號時刪掉舊連結，往下走）
   * 2. 外部 IdP 回報 **已驗證** 的 email 對上既有帳號 → 連結後登入；但 email 網域必須是這個連線登記的網域，
   *    帳號也不能持有管理用的系統角色，否則拒絕（`AUTH_SSO_LINK_NOT_ALLOWED`）
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
      // `(provider, subject)` 唯一，不刪掉的話同 email 的新帳號永遠連不上
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
      await this.users.publishCreated(created.id, []);
      return created;
    } catch (error) {
      // 同一個人在兩個分頁同時第一次登入：後到的那個對上剛建立的帳號
      if (isUniqueViolation(error)) throw new AppException('AUTH_SSO_EXTERNAL_FAILED');
      throw error;
    }
  }

  /**
   * 登入失敗的自動鎖定（`locked_until`）不擋外部 IdP：鎖定是擋猜密碼，外部 IdP 已經驗過本人
   * （docs/architecture/backend/04-auth.md §3.3）。
   */
  private assertUsable(user: UserRow | undefined): asserts user is UserRow {
    if (!user || user.deletedAt) throw new AppException('AUTH_SSO_ACCOUNT_NOT_FOUND');
    if (user.status === 'pending') throw new AppException('AUTH_ACCOUNT_PENDING');
    if (user.status !== 'active') throw new AppException('AUTH_ACCOUNT_DISABLED');
  }

  /**
   * 以 email 自動連結既有帳號的條件（docs/architecture/04-sso.md §3.3）：
   * - email 網域必須登記在 **這個** 連線底下：持 `identityProvider:*` 的人可以自架 IdP、對任何 email 簽出
   *   `email_verified`，不限網域就能連到別人的帳號
   * - 帳號不能持有 `member` 以外的系統角色（super-admin、admin、auditor）：這些帳號被接管的代價太高，
   *   要由本人以密碼登入（或由管理員處理），不自動連結。「持有」含經由群組（含巢狀）持有的
   */
  private async assertLinkable(
    provider: { id: string; domains: { domain: string }[] },
    user: UserRow,
  ): Promise<void> {
    const domain = domainOf(user.email);
    if (!provider.domains.some((item) => item.domain === domain)) {
      throw new AppException('AUTH_SSO_LINK_NOT_ALLOWED');
    }
    const roles = await this.users.listEffectiveRoles(user.id);
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
