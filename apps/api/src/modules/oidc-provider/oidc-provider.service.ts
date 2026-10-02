import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exportJWK, generateKeyPair } from 'jose';
import Provider, { errors, interactionPolicy } from 'oidc-provider';
import type {
  Account,
  ClientMetadata,
  Configuration,
  InteractionResults,
  JWKS,
  KoaContextWithOIDC,
} from 'oidc-provider';
import { z } from 'zod';

import type { Env } from '@/core/config';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { currentTenant, Tenancy, TenantDirectory } from '@/core/tenant';
import type { TenantRecord } from '@/core/tenant';
import { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';
import { UserService } from '@/modules/user/user.service';

import { parseAccountId, tenantAccountId } from './oidc-account';
import type { OidcAccount } from './oidc-account';
import { DrizzleOidcAdapter } from './oidc-adapter';
import { OidcPayloadRepository } from './oidc-payload.repository';
import { OIDC_CLIENT, OIDC_CLIENT_PATHS, OIDC_SCOPES, OIDC_TTL } from './oidc-provider.constants';
import type { OidcClientId } from './oidc-provider.constants';
import { isTenantRedirectAllowed } from './tenant-redirect';

/**
 * 外部 IdP 登入的暫存（以 `state` 為鍵）：發起時記下互動、PKCE verifier 與 nonce；
 * 外部 IdP 回來、驗證通過後補上 `accountId`，再由互動路徑底下的端點完成互動。
 */
const ExternalLoginStateSchema = z.object({
  interactionUid: z.string(),
  /** 這次登入的租戶（外部 IdP 連線屬於租戶，docs/architecture/05-tenancy.md §10.2 D18）。 */
  tenantId: z.string(),
  providerId: z.string(),
  codeVerifier: z.string(),
  nonce: z.string(),
  /** 驗證通過、對應到帳號之後才有。 */
  accountId: z.string().optional(),
});

export type ExternalLoginState = z.infer<typeof ExternalLoginStateSchema>;

const EXTERNAL_LOGIN = 'ExternalLogin';

/** 互動頁需要的資訊（不含 provider 內部物件）。 */
export interface InteractionSummary {
  uid: string;
  prompt: string;
  clientId: string;
  clientName: string;
  loginHint: string | null;
  /** 這次要登入哪個租戶；沒有時是平台管理者的登入（docs/architecture/05-tenancy.md §10.2 D8）。 */
  tenant: { id: string; code: string; name: string } | null;
}

/** 兌換授權碼的結果：誰、從哪個 IdP session 登入哪個產品。 */
export interface RedeemedCode {
  accountId: string;
  clientId: OidcClientId;
  sessionUid: string | null;
}

export type RedeemFailure = 'invalid_code' | 'client_mismatch' | 'redirect_mismatch' | 'pkce';

/** 在 PKCE 驗證失敗等情況下，呼叫端要回的是「無效」而不是細節（不洩漏哪一項不對）。 */
export class OidcRedeemError extends Error {
  constructor(readonly reason: RedeemFailure) {
    super(`authorization code redeem failed: ${reason}`);
  }
}

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * 把舊的身分從這個瀏覽器的 IdP session 拿掉，讓接下來的登入是一個全新的 session：清掉帳號與各 client 的 grant，
 * 並換一個新的 `uid`。
 *
 * 不這樣做的話，oidc-provider 在「已登入的 session 換成另一個帳號」時會先把舊的 session 登出
 * （`end_session_confirm`），觸發單一登出，另一個租戶開著的 backstage 也跟著被登出；而且 `uid` 不變，
 * 兩個租戶的 app session 會綁在同一個 IdP session 上，之後任一邊登出都會影響另一邊。
 * 換了 `uid` 之後，舊身分的 app session 仍綁在舊的 uid 上，各自登出互不影響（D9）。
 */
function detachIdentity(session: KoaContextWithOIDC['oidc']['session']): void {
  if (!session) return;
  clearAccount(session);
  const mutable = session as unknown as { authorizations?: Record<string, unknown>; uid: string };
  mutable.authorizations = {};
  mutable.uid = randomUUID();
}

/**
 * 清掉 session 上的帳號。provider 包在 session 外的 Proxy 不接受把 `accountId` 設成空值，
 * 所以用 delete（Proxy 沒有攔截 delete），再標記 session 已變更讓它被存回去。
 */
function clearAccount(session: KoaContextWithOIDC['oidc']['session']): void {
  if (!session) return;
  delete (session as unknown as { accountId?: string }).accountId;
  (session as unknown as { touched: boolean }).touched = true;
}

/**
 * `apps/api` 當 OIDC Provider（docs/architecture/04-sso.md §12）。以
 * [`oidc-provider`](https://github.com/panva/node-oidc-provider) 實作協定，儲存在 `oidc_payloads`。
 *
 * - 登入互動頁在 apps/auth；互動的 cookie 由 provider 設在 `/api/oidc-interaction/:uid`，
 *   所以互動網址先指向那裡（`AuthModule` 的互動 controller 再 302 到 apps/auth）。
 * - 第一方產品的授權碼由 BFF 在本程序內兌換（`redeemAuthorizationCode`），不經 token 端點（D3）。
 * - 每個 cookie 都是 host-only（`Domain` 不設），只屬於 apps/auth 的 origin（D6）。
 */
@Injectable()
export class OidcProviderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OidcProviderService.name);
  private provider!: Provider;
  private readonly issuer: URL;
  private unsubscribe?: () => void;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly repo: OidcPayloadRepository,
    private readonly users: UserService,
    private readonly platformAdmins: PlatformAdminService,
    private readonly directory: TenantDirectory,
    private readonly tenancy: Tenancy,
    private readonly events: DomainEventBus,
  ) {
    this.issuer = new URL(this.config.get('OIDC_ISSUER', { infer: true }));
  }

  async onModuleInit(): Promise<void> {
    const provider = new Provider(this.issuer.href, await this.configuration());
    // 反向代理之後：provider 以 X-Forwarded-* 決定網址與 cookie 的 secure；這兩個標頭由 `handle()` 依設定覆寫
    provider.proxy = true;
    provider.on('server_error', (_ctx, error) => this.logger.error({ err: error }, 'OIDC 錯誤'));
    this.allowTenantRedirects(provider);
    this.provider = provider;

    // 帳號停用、刪除、改密碼（token_version 遞增）時，這些人的 IdP session 一起結束：
    // 否則 IdP 上還留著一個指向不能用的帳號的 session（單一登出只帶 idpSessionUids、停用租戶只帶 tenantIds，
    // 這兩種由發佈端直接處理：`destroySession`、`endTenantSessions`，docs/architecture/backend/01-architecture.md §4）
    // 事件在租戶的脈絡裡發佈：userIds 是這個租戶的使用者，IdP 上的帳號 id 要帶上租戶（D6）
    this.unsubscribe = this.events.subscribe(DomainEvent.SESSIONS_REVOKED, ({ userIds }) => {
      const tenant = currentTenant();
      if (!userIds?.length || !tenant) return;
      void this.repo
        .destroySessionsOf(userIds.map((userId) => tenantAccountId(tenant.id, userId)))
        .catch((error: unknown) => this.logger.error({ err: error }, '結束 IdP session 失敗'));
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  // ── 第一方 client ─────────────────────────────────────────

  /**
   * 產品的 redirect URI 由產品網址產生（D7）；這一版沒有第三方 client。backstage 的 redirect URI
   * 實際上是「任何租戶網域的 callback」（`allowTenantRedirects`），這裡列的只是 client 的必填欄位。
   */
  clients(): ClientMetadata[] {
    const origins: Record<OidcClientId, string> = {
      [OIDC_CLIENT.BACKSTAGE]: this.config.get('APP_PUBLIC_URL', { infer: true }),
      [OIDC_CLIENT.AUTH]: this.config.get('AUTH_APP_URL', { infer: true }),
    };
    return (Object.keys(origins) as OidcClientId[]).map((clientId) => ({
      client_id: clientId,
      client_name: clientId,
      redirect_uris: [`${origins[clientId]}${OIDC_CLIENT_PATHS[clientId].callback}`],
      post_logout_redirect_uris: [`${origins[clientId]}${OIDC_CLIENT_PATHS[clientId].loggedOut}`],
      // public client ＋ PKCE：授權碼由產品自己 origin 的 BFF 兌換，token 不落到瀏覽器（D3）
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    }));
  }

  /**
   * backstage 的 redirect／登出後 URI：path 相符、host 是某個租戶的網域（docs/architecture/05-tenancy.md §10.2 D7）。
   * 屬於「哪一個」租戶由 authorize 的 `tenant` 參數交叉檢查（`validateTenantParam`）。
   * 其他 client 照 oidc-provider 原本的白名單比對。
   */
  private allowTenantRedirects(provider: Provider): void {
    type UriCheck = (this: { clientId: string }, value: string) => boolean;
    const proto = provider.Client.prototype as unknown as {
      redirectUriAllowed: UriCheck;
      postLogoutRedirectUriAllowed: UriCheck;
    };
    const paths = OIDC_CLIENT_PATHS[OIDC_CLIENT.BACKSTAGE];
    const strict = this.config.get('NODE_ENV', { infer: true }) === 'production';
    const onTenantDomain = (value: string, path: string): boolean =>
      isTenantRedirectAllowed(value, path, this.directory, strict);
    const redirectAllowed = proto.redirectUriAllowed;
    proto.redirectUriAllowed = function (value) {
      return this.clientId === OIDC_CLIENT.BACKSTAGE
        ? onTenantDomain(value, paths.callback)
        : redirectAllowed.call(this, value);
    };
    const logoutAllowed = proto.postLogoutRedirectUriAllowed;
    proto.postLogoutRedirectUriAllowed = function (value) {
      return this.clientId === OIDC_CLIENT.BACKSTAGE
        ? onTenantDomain(value, paths.loggedOut)
        : logoutAllowed.call(this, value);
    };
  }

  /**
   * authorize 的 `tenant` 參數（D7）：backstage 必須帶，而且 redirect URI 的網域要屬於這個租戶；
   * apps/auth（平台管理者）不能帶。錯誤會導回 redirect URI——它已經通過網域檢查，只會是某個租戶的 backstage。
   */
  private async validateTenantParam(
    ctx: KoaContextWithOIDC,
    value: string | undefined,
    clientId: string | undefined,
  ): Promise<void> {
    if (clientId !== OIDC_CLIENT.BACKSTAGE) {
      if (value) throw new errors.InvalidRequest('tenant is not allowed for this client');
      return;
    }
    if (!value) throw new errors.InvalidRequest('tenant is required');
    const tenant = await this.directory.findByCode(value);
    if (!tenant || tenant.status !== 'active') throw new errors.InvalidRequest('unknown tenant');
    const redirectUri = String(ctx.oidc.params?.redirect_uri ?? '');
    const host = URL.canParse(redirectUri) ? new URL(redirectUri).host : '';
    if (this.directory.tenantIdOfHost(host) !== tenant.id) {
      throw new errors.InvalidRequest('redirect_uri does not belong to the tenant');
    }
  }

  /** 這次授權要求的身分範圍：backstage 是 `tenant` 參數指定的租戶，apps/auth 是平台。 */
  private async requestedRealm(
    params: Record<string, unknown> | undefined,
    clientId: string | undefined,
  ): Promise<{ realm: 'platform' } | { realm: 'tenant'; tenant: TenantRecord } | undefined> {
    if (clientId === OIDC_CLIENT.AUTH) return { realm: 'platform' };
    const code = params?.tenant;
    const tenant = typeof code === 'string' ? await this.directory.findByCode(code) : undefined;
    // 互動進行到一半時租戶被停用：當作互動無效（authorize 時已擋下非 active 的租戶）
    return tenant?.status === 'active' ? { realm: 'tenant', tenant } : undefined;
  }

  isFirstParty(clientId: string): clientId is OidcClientId {
    return (Object.values(OIDC_CLIENT) as string[]).includes(clientId);
  }

  // ── HTTP ───────────────────────────────────────────────

  /**
   * 交給 provider 處理 `/oidc/*`。反向代理已去掉瀏覽器看到的前綴（`/api`），provider 卻以
   * `originalUrl` 與 Host 產生網址：這裡依 `OIDC_ISSUER` 還原，網址與 cookie 的 path 才會是瀏覽器看到的。
   */
  handle(mountPath: string): NodeHandler {
    const callback = this.provider.callback() as NodeHandler;
    return (req, res) => {
      const request = req as IncomingMessage & { originalUrl?: string };
      const full = request.originalUrl ?? req.url ?? '/';
      const rest = full.startsWith(mountPath) ? full.slice(mountPath.length) || '/' : full;
      req.url = rest;
      request.originalUrl = `${this.issuer.pathname}${rest}`;
      req.headers['x-forwarded-host'] = this.issuer.host;
      req.headers['x-forwarded-proto'] = this.issuer.protocol.replace(/:$/, '');
      callback(req, res);
    };
  }

  // ── 互動 ───────────────────────────────────────────────

  /** 讀取目前的互動；`uid` 必須與互動 cookie 一致（防止拿別人的互動網址來用）。 */
  async interaction(
    req: IncomingMessage,
    res: ServerResponse,
    uid: string,
  ): Promise<InteractionSummary | undefined> {
    const details = await this.provider.interactionDetails(req, res).catch(() => undefined);
    if (!details || details.uid !== uid) return undefined;
    const clientId = String(details.params.client_id ?? '');
    const client = await this.provider.Client.find(clientId);
    const loginHint = details.params.login_hint;
    const requested = await this.requestedRealm(details.params, clientId);
    // backstage 的互動一定帶租戶（authorize 已驗證）；找不到代表租戶在這之間被停用或刪除
    if (!requested) return undefined;
    return {
      uid: details.uid,
      prompt: details.prompt.name,
      clientId,
      clientName: client?.clientName ?? clientId,
      loginHint: typeof loginHint === 'string' ? loginHint : null,
      tenant:
        requested.realm === 'tenant'
          ? { id: requested.tenant.id, code: requested.tenant.code, name: requested.tenant.name }
          : null,
    };
  }

  /** 互動完成：回傳要讓瀏覽器 **頂層跳轉** 過去的網址（provider 的 resume 端點）。 */
  async finishInteraction(
    req: IncomingMessage,
    res: ServerResponse,
    result: InteractionResults,
  ): Promise<string> {
    return this.provider.interactionResult(req, res, result, { mergeWithLastSubmission: false });
  }

  // ── BFF：第一方產品兌換授權碼（D3）─────────────────────────

  /**
   * 在本程序內兌換授權碼，檢查與 token 端點相同的條件：存在、未用過、未過期、client 與
   * redirect URI 相符、PKCE（S256）。通過後標記為已用過；同一個碼只能兌換一次。
   */
  async redeemAuthorizationCode(input: {
    code: string;
    codeVerifier: string;
    clientId: string;
    redirectUri: string;
  }): Promise<RedeemedCode> {
    const code = await this.provider.AuthorizationCode.find(input.code).catch(() => undefined);
    if (!code?.isValid) {
      // 重放（找得到、沒過期卻無效 = 已用過）：撤銷同一個 grant 發出的東西（RFC 6749 §4.1.2）
      if (code && !code.isExpired && code.grantId) await this.repo.destroyByGrantId(code.grantId);
      throw new OidcRedeemError('invalid_code');
    }
    if (code.clientId !== input.clientId || !this.isFirstParty(code.clientId)) {
      throw new OidcRedeemError('client_mismatch');
    }
    if (code.redirectUri !== input.redirectUri) throw new OidcRedeemError('redirect_mismatch');
    const challenge = createHash('sha256').update(input.codeVerifier).digest('base64url');
    if (code.codeChallengeMethod !== 'S256' || code.codeChallenge !== challenge) {
      throw new OidcRedeemError('pkce');
    }
    if (!code.accountId) throw new OidcRedeemError('invalid_code');
    // 條件式消耗：同一個碼的併發兌換只有一個搶得到，另一個照重放處理（撤銷整個 grant）
    if (!(await this.repo.consumeOnce('AuthorizationCode', code.jti))) {
      if (code.grantId) await this.repo.destroyByGrantId(code.grantId);
      throw new OidcRedeemError('invalid_code');
    }
    return {
      accountId: code.accountId,
      clientId: code.clientId,
      sessionUid: code.sessionUid ?? null,
    };
  }

  // ── 外部 IdP 登入的暫存（D8）────────────────────────────────

  async saveExternalLogin(
    state: string,
    value: ExternalLoginState,
    ttlSeconds: number,
  ): Promise<void> {
    await this.repo.upsert({
      type: EXTERNAL_LOGIN,
      id: state,
      payload: { ...value },
      grantId: null,
      uid: value.interactionUid,
      userCode: null,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    });
  }

  /** 找得到、沒過期、沒用過時回傳；否則 undefined。 */
  async findExternalLogin(state: string): Promise<ExternalLoginState | undefined> {
    const row = await this.repo.find(EXTERNAL_LOGIN, state);
    if (!row || row.consumedAt || (row.expiresAt && row.expiresAt.getTime() <= Date.now())) {
      return undefined;
    }
    const parsed = ExternalLoginStateSchema.safeParse(row.payload);
    return parsed.success ? parsed.data : undefined;
  }

  /**
   * 用過即作廢：同一個 state 不能完成兩次互動。回傳是否搶到——併發的兩個請求只有一個會是 true
   */
  async consumeExternalLogin(state: string): Promise<boolean> {
    return this.repo.consumeOnce(EXTERNAL_LOGIN, state);
  }

  // ── 單一登出（D5）───────────────────────────────────────

  /** 銷毀 IdP session：apps/auth 上的 session cookie 之後指向不存在的 session，等同登出。 */
  async destroySession(sessionUid: string): Promise<void> {
    const session = await this.provider.Session.findByUid(sessionUid);
    if (session) await session.destroy();
  }

  /** 結束某個租戶所有帳號的 IdP session 與 grant（停用、刪除租戶，docs/architecture/05-tenancy.md §10.2 D13）。 */
  async endTenantSessions(tenantId: string): Promise<number> {
    return this.repo.destroyAllOfTenant(tenantId);
  }

  /** provider 自己的 end-session（第三方 RP 用）結束時：交給呼叫端撤銷那個身分的 app session。 */
  onSessionEnded(listener: (sessionUid: string, account: OidcAccount | undefined) => void): void {
    this.provider.on('end_session.success', (ctx: KoaContextWithOIDC) => {
      const uid = ctx.oidc.session?.uid;
      if (uid) listener(uid, parseAccountId(ctx.oidc.session?.accountId));
    });
  }

  // ── 設定 ───────────────────────────────────────────────

  private async configuration(): Promise<Configuration> {
    const cookieKeys = this.config.get('OIDC_COOKIE_KEYS', { infer: true }) ?? [
      // 開發用：每次啟動不同，重啟後 IdP session 失效（production 由 env 驗證擋下）
      randomUUID(),
    ];
    const firstParty = (clientId: string) => this.isFirstParty(clientId);
    return {
      adapter: (name: string) => new DrizzleOidcAdapter(name, this.repo),
      clients: this.clients(),
      jwks: await this.jwks(),
      cookies: {
        keys: cookieKeys,
        long: { signed: true, sameSite: 'lax' },
        short: { signed: true, sameSite: 'lax' },
      },
      scopes: [...OIDC_SCOPES],
      // `tenant`：帳號屬於哪個租戶（代碼）；平台管理者沒有（docs/architecture/05-tenancy.md §10.2 D6）
      claims: {
        openid: ['sub', 'tenant'],
        email: ['email', 'email_verified'],
        profile: ['name'],
      },
      extraParams: {
        tenant: (ctx, value, client) => this.validateTenantParam(ctx, value, client?.clientId),
      },
      findAccount: async (ctx, sub) => {
        const account = await this.findAccount(sub);
        if (!account) {
          // IdP session 還指向這個帳號（例：剛被停用）：清掉，改走登入互動。
          // 不清的話 provider 會在沒有帳號的情況下繼續檢查同意而拋錯
          if (ctx.oidc.session?.accountId === sub) clearAccount(ctx.oidc.session);
          return undefined;
        }
        return account;
      },
      features: {
        devInteractions: { enabled: false },
        rpInitiatedLogout: { enabled: true },
      },
      pkce: { required: () => true },
      // 協定錯誤（例：未註冊的 redirect URI）不能導回產品，改在 apps/auth 的錯誤頁顯示
      renderError: (ctx, out) => {
        const query = new URLSearchParams({ error: String(out.error ?? 'server_error') });
        ctx.status = 303;
        ctx.redirect(
          `${this.config.get('AUTH_APP_URL', { infer: true })}/error?${query.toString()}`,
        );
      },
      responseTypes: ['code'],
      ttl: { ...OIDC_TTL },
      interactions: {
        policy: this.interactionPolicy(),
        // 見 class 註解：互動 cookie 的 path 取自這個網址
        url: (_ctx, interaction) =>
          `${this.issuer.origin}${this.apiPrefix()}/oidc-interaction/${interaction.uid}`,
      },
      // 第一方產品不出現同意頁：第一次授權時直接建立 grant（D7）
      loadExistingGrant: async (ctx) => {
        const { oidc } = ctx;
        const clientId = oidc.client?.clientId;
        const accountId = oidc.session?.accountId;
        if (!clientId || !accountId) return undefined;
        const grantId =
          (oidc.result?.consent as { grantId?: string } | undefined)?.grantId ??
          oidc.session?.grantIdFor(clientId);
        if (grantId) return oidc.provider.Grant.find(grantId);
        if (!firstParty(clientId)) return undefined;
        const grant = new oidc.provider.Grant({ clientId, accountId });
        grant.addOIDCScope(OIDC_SCOPES.join(' '));
        await grant.save();
        return grant;
      },
    };
  }

  /**
   * IdP 帳號 → 目前可以登入的使用者或平台管理者（D6）。租戶帳號在那個租戶的 DB 查；
   * 租戶停用、刪除或帳號不能用時回 undefined。
   */
  private async findAccount(sub: string): Promise<Account | undefined> {
    const account = parseAccountId(sub);
    if (account?.realm === 'platform') {
      const admin = await this.platformAdmins.findActive(account.adminId);
      if (!admin) return undefined;
      return {
        accountId: sub,
        claims: () => ({ sub, email: admin.email, email_verified: true, name: admin.displayName }),
      };
    }
    if (account?.realm !== 'tenant') return undefined;
    const tenant = await this.directory.findById(account.tenantId);
    if (!tenant || tenant.status !== 'active') return undefined;
    const user = await this.tenancy.run(tenant.id, () =>
      this.users.findAccountById(account.userId),
    );
    if (!user || user.deletedAt || user.status !== 'active') return undefined;
    return {
      accountId: sub,
      claims: () => ({
        sub,
        email: user.email,
        email_verified: true,
        name: user.displayName,
        tenant: tenant.code,
      }),
    };
  }

  /**
   * 預設的互動 policy，再加一條：IdP session 的帳號與這次要求的身分範圍不同（別的租戶、或平台／租戶互換）
   * 就要求重新登入（docs/architecture/05-tenancy.md §10.2 D9）。見 `detachIdentity`。
   */
  private interactionPolicy(): interactionPolicy.Prompt[] {
    const policy = interactionPolicy.base();
    const login = policy.get('login');
    if (!login) throw new Error('oidc-provider 的預設 policy 沒有 login prompt');
    login.checks.add(
      new interactionPolicy.Check(
        'realm_mismatch',
        'the signed-in account belongs to another tenant or realm',
        async (ctx) => {
          const account = parseAccountId(ctx.oidc.session?.accountId);
          // 沒有登入由預設的 no_session 處理；格式不對的舊 session 也要重新登入
          if (!ctx.oidc.session?.accountId) return interactionPolicy.Check.NO_NEED_TO_PROMPT;
          if (!account) return interactionPolicy.Check.REQUEST_PROMPT;
          const requested = await this.requestedRealm(ctx.oidc.params, ctx.oidc.client?.clientId);
          if (!requested) return interactionPolicy.Check.REQUEST_PROMPT;
          const same =
            requested.realm === 'platform'
              ? account.realm === 'platform'
              : account.realm === 'tenant' && account.tenantId === requested.tenant.id;
          if (same) return interactionPolicy.Check.NO_NEED_TO_PROMPT;
          detachIdentity(ctx.oidc.session);
          return interactionPolicy.Check.REQUEST_PROMPT;
        },
      ),
    );
    return policy;
  }

  /** 瀏覽器看到的 api 前綴：issuer 路徑去掉最後的 `/oidc`（例：`/api`）。 */
  private apiPrefix(): string {
    return this.issuer.pathname.replace(/\/oidc$/, '');
  }

  /** `OIDC_JWKS`；沒設定時（僅開發）產生一把臨時的 RS256 金鑰。 */
  private async jwks(): Promise<JWKS> {
    const raw = this.config.get('OIDC_JWKS', { infer: true });
    if (raw) return JSON.parse(raw) as JWKS;
    this.logger.warn('未設定 OIDC_JWKS：使用臨時金鑰（重啟後已發出的 ID token 失效）');
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const jwk = await exportJWK(privateKey);
    return { keys: [{ ...jwk, kid: randomUUID(), alg: 'RS256', use: 'sig' }] } as JWKS;
  }
}
