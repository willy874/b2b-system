import { Injectable } from '@nestjs/common';
import * as client from 'openid-client';

/** 連線到外部 IdP 需要的設定（client secret 已解密）。 */
export interface ExternalProviderConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
}

/** 外部 IdP 回報的身分（ID token 驗證通過之後）。 */
export interface ExternalIdentity {
  subject: string;
  email: string | null;
  /** 只有外部 IdP 明確回報 `email_verified: true` 才是 true（D8：未驗證的 email 不能拿來對應帳號）。 */
  emailVerified: boolean;
  name: string | null;
}

/**
 * 外部 IdP 的 OIDC RP（docs/adr/0019-sso-identity-platform.md D8）。抽象類別同時是 DI token：
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

/** 以 [`openid-client`](https://github.com/panva/openid-client)（OpenID Certified）實作。 */
@Injectable()
export class OpenIdExternalOidcClient extends ExternalOidcClient {
  /** discovery 的結果快取（issuer ＋ client）：不必每次登入都抓一次 `.well-known`。 */
  private readonly configs = new Map<string, Promise<client.Configuration>>();

  constructor(private readonly allowInsecureIssuer: boolean) {
    super();
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
    const claims: Record<string, unknown> =
      typeof idToken.email === 'string'
        ? idToken
        : await client.fetchUserInfo(config, tokens.access_token, idToken.sub);
    return {
      subject: idToken.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      emailVerified: claims.email_verified === true,
      name: typeof claims.name === 'string' ? claims.name : null,
    };
  }

  private configOf(provider: ExternalProviderConfig): Promise<client.Configuration> {
    const key = `${provider.issuer}\n${provider.clientId}\n${provider.clientSecret}`;
    let config = this.configs.get(key);
    if (!config) {
      config = client
        .discovery(
          new URL(provider.issuer),
          provider.clientId,
          provider.clientSecret,
          undefined,
          // 開發環境的模擬 IdP 是 http；production 只接受 https
          this.allowInsecureIssuer ? { execute: [client.allowInsecureRequests] } : undefined,
        )
        .catch((error: unknown) => {
          this.configs.delete(key);
          throw error;
        });
      this.configs.set(key, config);
    }
    return config;
  }
}
