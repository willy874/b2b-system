import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import * as client from 'openid-client';

import { pinnedFetch, systemLookup } from '@/core/http';
import type { HostLookup, PinnedFetch } from '@/core/http';
import type { IdentityProviderPreset } from '@/db/schema';

import { isEmailVerifiedForPreset } from './oidc-presets';

/** 連線到外部 IdP 需要的設定（client secret 已解密）。 */
export interface ExternalProviderConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  /** 決定「email 是否已驗證」怎麼判斷（docs/architecture/04-sso.md §3.3.1）。 */
  preset: IdentityProviderPreset;
}

/** 外部 IdP 回報的身分（ID token 驗證通過之後）。 */
export interface ExternalIdentity {
  subject: string;
  email: string | null;
  /**
   * email 能不能拿來對應既有帳號（D8：未驗證的 email 不能）。OIDC 依範本判斷（一般是 `email_verified: true`）；
   * SAML 沒有這個概念，由 IdP 斷言的 email 一律視為已驗證，防線是「網域必須屬於這個連線」（§3.3）。
   */
  emailVerified: boolean;
  name: string | null;
}

/**
 * 外部 IdP 的 OIDC RP（docs/architecture/04-sso.md §12.2 D8）。抽象類別同時是 DI token：
 * 整合測試換成假的實作，不必連到真的 Google／Azure AD。
 */
export abstract class ExternalOidcClient {
  abstract authorizationUrl(
    provider: ExternalProviderConfig,
    params: { redirectUri: string; state: string; nonce: string; codeChallenge: string },
  ): Promise<string>;

  /** 以 callback 的完整網址兌換授權碼並驗證 ID token（state、nonce、PKCE、簽章、audience）。 */
  abstract exchange(
    provider: ExternalProviderConfig,
    params: { currentUrl: string; state: string; nonce: string; codeVerifier: string },
  ): Promise<ExternalIdentity>;
}

export interface OpenIdExternalOidcClientOptions {
  /** 開發環境的模擬 IdP 是 http；production 只接受 https。 */
  allowInsecureIssuer: boolean;
  /**
   * 擋下解析到私有、loopback、link-local 位址的連線（discovery、token、userinfo、JWKS 都算）：
   * issuer 由租戶管理員填，不擋的話就能讓 api 代為探測內網。
   * 開發環境的模擬 IdP 在 localhost，只在 production 開。
   */
  blockPrivateNetworks: boolean;
  resolve?: HostLookup;
}

/** discovery 快取的上限：連線數量本來就少，超過代表 secret 或 issuer 一直在換，丟掉最舊的。 */
const MAX_CACHED_CONFIGS = 200;
/** 對外部 IdP 每個請求的逾時（秒）：卡住的 IdP 不能拖住登入的請求。 */
const REQUEST_TIMEOUT_SECONDS = 10;

/** 以 [`openid-client`](https://github.com/panva/openid-client)（OpenID Certified）實作。 */
@Injectable()
export class OpenIdExternalOidcClient extends ExternalOidcClient {
  /**
   * discovery 的結果快取（issuer ＋ client ＋ secret 的雜湊）：不必每次登入都抓一次 `.well-known`。
   * key 不放 secret 原文；有上限，換 secret 之後舊的 entry 會被擠掉。
   */
  private readonly configs = new Map<string, Promise<client.Configuration>>();
  /** 所有 IdP 共用一個綁定位址的 fetch（一個連線池）；只在 `blockPrivateNetworks` 時建立。 */
  private readonly fetch: PinnedFetch | undefined;

  constructor(private readonly options: OpenIdExternalOidcClientOptions) {
    super();
    this.fetch = options.blockPrivateNetworks
      ? pinnedFetch(options.resolve ?? systemLookup)
      : undefined;
  }

  async authorizationUrl(
    provider: ExternalProviderConfig,
    params: { redirectUri: string; state: string; nonce: string; codeChallenge: string },
  ): Promise<string> {
    const config = await this.configOf(provider);
    return client
      .buildAuthorizationUrl(config, {
        redirect_uri: params.redirectUri,
        scope: provider.scopes,
        state: params.state,
        nonce: params.nonce,
        code_challenge: params.codeChallenge,
        code_challenge_method: 'S256',
      })
      .toString();
  }

  async exchange(
    provider: ExternalProviderConfig,
    params: { currentUrl: string; state: string; nonce: string; codeVerifier: string },
  ): Promise<ExternalIdentity> {
    const config = await this.configOf(provider);
    const tokens = await client.authorizationCodeGrant(config, new URL(params.currentUrl), {
      pkceCodeVerifier: params.codeVerifier,
      expectedState: params.state,
      expectedNonce: params.nonce,
      idTokenExpected: true,
    });
    const idToken = tokens.claims();
    if (!idToken) throw new Error('外部 IdP 沒有回傳 ID token');
    // 有些 IdP 只把 email 放在 userinfo（OIDC Core §5.4：以 code 流程取得時，scope 的 claims 預設在 userinfo）
    // 範本要看的 claim（Google 的 `hd`、Entra 的 `xms_edov`）在 ID token：合併時 ID token 優先
    const claims: Record<string, unknown> =
      typeof idToken.email === 'string'
        ? idToken
        : {
            ...(await client.fetchUserInfo(config, tokens.access_token, idToken.sub)),
            ...idToken,
          };
    const email = typeof claims.email === 'string' ? claims.email : null;
    return {
      subject: idToken.sub,
      email,
      emailVerified: isEmailVerifiedForPreset(provider.preset, claims, email),
      name: typeof claims.name === 'string' ? claims.name : null,
    };
  }

  private configOf(provider: ExternalProviderConfig): Promise<client.Configuration> {
    const secretHash = createHash('sha256').update(provider.clientSecret).digest('base64url');
    const key = `${provider.issuer}\n${provider.clientId}\n${secretHash}`;
    const cached = this.configs.get(key);
    if (cached) {
      // LRU：用到的移到最後
      this.configs.delete(key);
      this.configs.set(key, cached);
      return cached;
    }
    const config = client
      .discovery(new URL(provider.issuer), provider.clientId, provider.clientSecret, undefined, {
        timeout: REQUEST_TIMEOUT_SECONDS,
        ...(this.fetch && { [client.customFetch]: this.fetch }),
        ...(this.options.allowInsecureIssuer && { execute: [client.allowInsecureRequests] }),
      })
      .catch((error: unknown) => {
        this.configs.delete(key);
        throw error;
      });
    this.configs.set(key, config);
    if (this.configs.size > MAX_CACHED_CONFIGS) {
      const oldest = this.configs.keys().next();
      if (!oldest.done) this.configs.delete(oldest.value);
    }
    return config;
  }
}
