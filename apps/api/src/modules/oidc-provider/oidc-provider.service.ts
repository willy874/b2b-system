import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exportJWK, generateKeyPair } from 'jose';
import Provider from 'oidc-provider';
import type {
  ClientMetadata,
  Configuration,
  InteractionResults,
  JWKS,
  KoaContextWithOIDC,
} from 'oidc-provider';
import { z } from 'zod';

import type { Env } from '@/core/config';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { UserService } from '@/modules/user/user.service';

import { DrizzleOidcAdapter } from './oidc-adapter';
import { OidcPayloadRepository } from './oidc-payload.repository';
import { OIDC_CLIENT, OIDC_CLIENT_PATHS, OIDC_SCOPES, OIDC_TTL } from './oidc-provider.constants';
import type { OidcClientId } from './oidc-provider.constants';

/**
 * 外部 IdP 登入的暫存（以 `state` 為鍵）：發起時記下互動、PKCE verifier 與 nonce；
 * 外部 IdP 回來、驗證通過後補上 `accountId`，再由互動路徑底下的端點完成互動。
 */
const ExternalLoginStateSchema = z.object({
  interactionUid: z.string(),
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
 * `apps/api` 當 OIDC Provider（docs/adr/0019-sso-identity-platform.md）。以
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
    private readonly events: DomainEventBus,
  ) {
    this.issuer = new URL(this.config.get('OIDC_ISSUER', { infer: true }));
  }

  async onModuleInit(): Promise<void> {
    const provider = new Provider(this.issuer.href, await this.configuration());
    // 反向代理之後：provider 以 X-Forwarded-* 決定網址與 cookie 的 secure；這兩個標頭由 `handle()` 依設定覆寫
    provider.proxy = true;
    provider.on('server_error', (_ctx, error) => this.logger.error({ err: error }, 'OIDC 錯誤'));
    this.provider = provider;

    // 帳號停用、刪除、改密碼（token_version 遞增）時，這些人的 IdP session 一起結束：
    // 否則 IdP 上還留著一個指向不能用的帳號的 session（單一登出只帶 idpSessionUids，這裡不處理）
    this.unsubscribe = this.events.subscribe(DomainEvent.SESSIONS_REVOKED, ({ userIds }) => {
      if (!userIds?.length) return;
      void this.repo
        .destroySessionsOf(userIds)
        .catch((error: unknown) => this.logger.error({ err: error }, '結束 IdP session 失敗'));
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  // ── 第一方 client ─────────────────────────────────────────

  /** 產品的 redirect URI 由產品網址產生（D7）；這一版沒有第三方 client。 */
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
    return {
      uid: details.uid,
      prompt: details.prompt.name,
      clientId,
      clientName: client?.clientName ?? clientId,
      loginHint: typeof loginHint === 'string' ? loginHint : null,
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
    await code.consume();
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

  /** 用過即作廢：同一個 state 不能完成兩次互動。 */
  async consumeExternalLogin(state: string): Promise<void> {
    await this.repo.consume(EXTERNAL_LOGIN, state);
  }

  // ── 單一登出（D5）───────────────────────────────────────

  /** 銷毀 IdP session：apps/auth 上的 session cookie 之後指向不存在的 session，等同登出。 */
  async destroySession(sessionUid: string): Promise<void> {
    const session = await this.provider.Session.findByUid(sessionUid);
    if (session) await session.destroy();
  }

  /** provider 自己的 end-session（第三方 RP 用）結束時：交給呼叫端撤銷 app session。 */
  onSessionEnded(listener: (sessionUid: string) => void): void {
    this.provider.on('end_session.success', (ctx: KoaContextWithOIDC) => {
      const uid = ctx.oidc.session?.uid;
      if (uid) listener(uid);
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
      claims: { openid: ['sub'], email: ['email', 'email_verified'], profile: ['name'] },
      findAccount: async (ctx, sub) => {
        const user = await this.users.findAccountById(sub);
        if (!user || user.deletedAt || user.status !== 'active') {
          // IdP session 還指向這個帳號（例：剛被停用）：清掉，改走登入互動。
          // 不清的話 provider 會在沒有帳號的情況下繼續檢查同意而拋錯
          if (ctx.oidc.session?.accountId === sub) ctx.oidc.session.accountId = undefined;
          return undefined;
        }
        return {
          accountId: sub,
          claims: () => ({ sub, email: user.email, email_verified: true, name: user.displayName }),
        };
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
