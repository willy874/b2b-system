import type { IdentityProviderPreset } from '@/db/schema';

/** ID token／userinfo 的 claims（驗證過簽章之後）。 */
export type OidcClaims = Record<string, unknown>;

interface OidcPresetRule {
  /** issuer 的格式；不符時建立、更新回 `VALIDATION_FAILED`（`fields.issuer`）。 */
  issuerPattern?: RegExp;
  /** 這個 email 能不能拿來對應既有帳號（docs/architecture/04-sso.md §12.2 D8：只認已驗證的 email）。 */
  isEmailVerified(claims: OidcClaims, email: string): boolean;
}

const standardEmailVerified = (claims: OidcClaims): boolean => claims.email_verified === true;

/** `alice@Acme.com` → `acme.com`。 */
function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

/**
 * OIDC 連線的範本（docs/architecture/04-sso.md §3.3.1）。範本只改兩件事：issuer 必須長什麼樣子、
 * email 怎樣才算已驗證。授權網址、兌換、簽章驗證都是同一份 openid-client 的流程。
 */
export const OIDC_PRESETS = {
  generic: { isEmailVerified: standardEmailVerified },
  /**
   * Google Workspace：`email_verified` 對一般的 Gmail 帳號也是 true，所以另外要求 `hd`（託管網域）與 email 的網域相同——
   * 只有組織管理的帳號才能以 email 對應既有帳號或自動建立。
   */
  google: {
    issuerPattern: /^https:\/\/accounts\.google\.com$/,
    isEmailVerified: (claims, email) =>
      standardEmailVerified(claims) &&
      typeof claims.hd === 'string' &&
      claims.hd.toLowerCase() === emailDomain(email),
  },
  /**
   * Microsoft Entra ID：issuer 必須是 **單一目錄** 的 v2 端點（`common`／`organizations` 會接受任何目錄的帳號）。
   * Entra 不回 `email_verified`；`email` 是可以由使用者修改的屬性，只有選用的 claim `xms_edov`
   * （email 的網域已由目錄驗證）是 true 時才算已驗證。要在 Entra 的應用程式註冊加上這個選用 claim。
   */
  microsoft: {
    issuerPattern:
      /^https:\/\/login\.microsoftonline\.com\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/v2\.0$/,
    isEmailVerified: (claims) =>
      standardEmailVerified(claims) || claims.xms_edov === true || claims.xms_edov === 'true',
  },
  /** Okta：組織的授權伺服器（`https://<org>.okta.com`）或自訂的（`…/oauth2/<id>`）。 */
  okta: {
    issuerPattern: /^https:\/\/[a-z0-9.-]+(\/oauth2\/[A-Za-z0-9]+)?$/,
    isEmailVerified: standardEmailVerified,
  },
  /** Keycloak：`<base>/realms/<realm>`。 */
  keycloak: {
    issuerPattern: /^https?:\/\/[^\s?#]+\/realms\/[^/\s?#]+$/,
    isEmailVerified: standardEmailVerified,
  },
} as const satisfies Record<IdentityProviderPreset, OidcPresetRule>;

/** issuer 是否符合範本的格式（generic 不限）。 */
export function isIssuerAllowedForPreset(preset: IdentityProviderPreset, issuer: string): boolean {
  const rule: OidcPresetRule = OIDC_PRESETS[preset];
  return rule.issuerPattern?.test(issuer) ?? true;
}

/** 依範本判斷 email 是否已驗證；沒有 email 時一律 false。 */
export function isEmailVerifiedForPreset(
  preset: IdentityProviderPreset,
  claims: OidcClaims,
  email: string | null,
): boolean {
  if (!email) return false;
  const rule: OidcPresetRule = OIDC_PRESETS[preset];
  return rule.isEmailVerified(claims, email);
}
