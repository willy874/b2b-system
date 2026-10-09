import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { generateServiceProviderMetadata, SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import type { CacheProvider, Profile, SamlConfig } from '@node-saml/node-saml';

import type { ExternalIdentity } from './external-oidc.client';

/** SAML 連線的設定（docs/architecture/04-sso.md §3.3.2）。 */
export interface ExternalSamlProviderConfig {
  /** IdP 的 entity ID（回應的 `Issuer` 必須相同）。 */
  entityId: string;
  /** IdP 的 SSO 網址（HTTP-Redirect binding）。 */
  ssoUrl: string;
  /** IdP 的簽章憑證（PEM）；輪替期間可以有多張。 */
  certificates: string[];
  nameIdFormat: SamlNameIdFormat;
  /** email 所在的屬性；沒填時依常見的名稱找，再沒有且 NameID 是 email 格式時用 NameID。 */
  emailAttribute: string | null;
  nameAttribute: string | null;
}

/** 我們這一端（SP）的識別：entity ID 與 ACS 網址。 */
export interface SamlServiceProvider {
  entityId: string;
  acsUrl: string;
}

export const SAML_NAME_ID_FORMATS = {
  persistent: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
  emailAddress: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
  unspecified: 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
} as const;

export type SamlNameIdFormat = keyof typeof SAML_NAME_ID_FORMATS;

/** 沒指定屬性時依序找的 email 屬性（Entra／ADFS 的 claim URI、LDAP 的 `mail` 與它的 OID、常見的短名稱）。 */
const EMAIL_ATTRIBUTES = [
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
  'email',
  'mail',
  'Email',
] as const;

const NAME_ATTRIBUTES = [
  'http://schemas.microsoft.com/identity/claims/displayname',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  'urn:oid:2.16.840.1.113730.3.1.241',
  'displayName',
  'name',
] as const;

/** 允許的時鐘誤差：IdP 與我們的時間差太多時回應的 `NotBefore` 會被拒絕。 */
const CLOCK_SKEW_MS = 2 * 60 * 1000;

/**
 * 外部 IdP 的 SAML 2.0 SP（docs/architecture/04-sso.md §3.3.2）。抽象類別同時是 DI token：整合測試換成假的實作。
 */
export abstract class ExternalSamlClient {
  /** 產生 AuthnRequest，回傳要跳轉的網址（HTTP-Redirect binding）與 request 的 ID（之後比對 `InResponseTo`）。 */
  abstract authorizationUrl(
    provider: ExternalSamlProviderConfig,
    sp: SamlServiceProvider,
    params: { relayState: string },
  ): Promise<{ url: string; requestId: string }>;

  /**
   * 驗證 ACS 收到的 `SAMLResponse`：簽章（assertion 必須簽章）、Issuer、Audience、時間、`InResponseTo` 必須是這次的 request。
   * 不通過時拋錯（呼叫端轉成 `AUTH_SSO_EXTERNAL_FAILED`）。
   */
  abstract validate(
    provider: ExternalSamlProviderConfig,
    sp: SamlServiceProvider,
    params: { samlResponse: string; requestId: string },
  ): Promise<ExternalIdentity>;

  /** 給 IdP 匯入的 SP metadata（XML）。 */
  abstract metadata(provider: ExternalSamlProviderConfig, sp: SamlServiceProvider): string;
}

/**
 * 只認一個 request ID 的 cache：node-saml 以 cache 記住發出去的 request、在回應時比對 `InResponseTo`。
 * 我們的 request ID 存在 `oidc_payloads` 的 `ExternalLogin`（以 RelayState 找回），所以每次驗證只放進那一個；
 * 別的瀏覽器發起的 request 的回應拿不到這裡來用。
 */
function singleRequestCache(requestId: string | null): CacheProvider {
  let current = requestId;
  return {
    saveAsync: async (_key, value) => ({ value, createdAt: Date.now() }),
    // 值是 request 發出的時間：node-saml 以它判斷 request 是否過期。過期由 `ExternalLogin` 的 10 分鐘負責，這裡給現在
    getAsync: async (key) =>
      current !== null && key === current ? new Date().toISOString() : null,
    removeAsync: async (key) => {
      if (key === current) current = null;
      return key;
    },
  };
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return firstString(value[0]);
  return null;
}

/** `alice@acme.com` 形式才算 email（NameID 不一定是）。 */
function asEmail(value: string | null): string | null {
  return value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/** 以 [`@node-saml/node-saml`](https://github.com/node-saml/node-saml) 實作。 */
@Injectable()
export class NodeSamlExternalClient extends ExternalSamlClient {
  async authorizationUrl(
    provider: ExternalSamlProviderConfig,
    sp: SamlServiceProvider,
    params: { relayState: string },
  ): Promise<{ url: string; requestId: string }> {
    // SAML 的 ID 是 xsd:ID：不能以數字開頭
    const requestId = `_${randomBytes(20).toString('hex')}`;
    const saml = this.samlOf(provider, sp, null, () => requestId);
    const url = await saml.getAuthorizeUrlAsync(params.relayState, undefined, {});
    return { url, requestId };
  }

  async validate(
    provider: ExternalSamlProviderConfig,
    sp: SamlServiceProvider,
    params: { samlResponse: string; requestId: string },
  ): Promise<ExternalIdentity> {
    const saml = this.samlOf(provider, sp, params.requestId);
    const { profile } = await saml.validatePostResponseAsync({ SAMLResponse: params.samlResponse });
    if (!profile?.nameID) throw new Error('SAML 回應沒有 NameID');
    // node-saml 的 idpIssuer 只檢查登出訊息；登入的 assertion 自己比對（簽過章的 assertion 的 Issuer）。
    // 同一張簽章憑證可能用在 IdP 的多個 entity（例：ADFS 全部的 relying party 共用一張），只靠憑證分不出來
    if (profile.issuer !== provider.entityId) {
      throw new Error(`SAML 的 Issuer 不是這個連線：${profile.issuer}`);
    }
    return this.identityOf(provider, profile);
  }

  metadata(provider: ExternalSamlProviderConfig, sp: SamlServiceProvider): string {
    return generateServiceProviderMetadata({
      issuer: sp.entityId,
      callbackUrl: sp.acsUrl,
      identifierFormat: SAML_NAME_ID_FORMATS[provider.nameIdFormat],
      wantAssertionsSigned: true,
    });
  }

  private identityOf(provider: ExternalSamlProviderConfig, profile: Profile): ExternalIdentity {
    const attribute = (name: string): string | null => firstString(profile[name]);
    const email = asEmail(
      provider.emailAttribute
        ? attribute(provider.emailAttribute)
        : (EMAIL_ATTRIBUTES.map(attribute).find(Boolean) ?? null),
    );
    const name = provider.nameAttribute
      ? attribute(provider.nameAttribute)
      : (NAME_ATTRIBUTES.map(attribute).find(Boolean) ?? null);
    const nameIdIsEmail = profile.nameIDFormat === SAML_NAME_ID_FORMATS.emailAddress;
    const resolvedEmail = email ?? (nameIdIsEmail ? asEmail(profile.nameID) : null);
    return {
      subject: profile.nameID,
      email: resolvedEmail,
      // SAML 沒有 email_verified：IdP 簽章斷言的目錄 email 視為已驗證；防線是「網域必須屬於這個連線」（§3.3）
      emailVerified: resolvedEmail !== null,
      name,
    };
  }

  private samlOf(
    provider: ExternalSamlProviderConfig,
    sp: SamlServiceProvider,
    expectedRequestId: string | null,
    generateUniqueId?: () => string,
  ): SAML {
    const options: SamlConfig = {
      entryPoint: provider.ssoUrl,
      issuer: sp.entityId,
      callbackUrl: sp.acsUrl,
      audience: sp.entityId,
      idpIssuer: provider.entityId,
      idpCert: provider.certificates,
      identifierFormat: SAML_NAME_ID_FORMATS[provider.nameIdFormat],
      // 多數 IdP 只簽 assertion；assertion 一定要簽（只簽外層 Response 的話 assertion 可以被換掉）
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.always,
      cacheProvider: singleRequestCache(expectedRequestId),
      requestIdExpirationPeriodMs: 10 * 60 * 1000,
      acceptedClockSkewMs: CLOCK_SKEW_MS,
      // 不要求特定的驗證方式（例：密碼）：企業的 IdP 可能用 MFA、憑證或 Windows 整合驗證
      disableRequestedAuthnContext: true,
      ...(generateUniqueId && { generateUniqueId }),
    };
    return new SAML(options);
  }
}
