import type {
  CreateIdentityProviderRequest,
  IdentityProvider,
  IdentityProviderDomain,
  UpdateIdentityProviderRequest,
} from '@/shared/api-sdk';

/**
 * 外部 IdP 連線的表單（docs/architecture/04-sso.md §3.3）：表單狀態 ⇄ API 的形狀、驗證。
 * 兩種協定共用一份狀態，送出時只取那個協定的欄位。
 */

export type Protocol = IdentityProvider['protocol'];
export type Preset = IdentityProvider['preset'];
export type UnmatchedPolicy = IdentityProvider['unmatchedPolicy'];
export type NameIdFormat = NonNullable<IdentityProvider['saml']>['nameIdFormat'];

export const OIDC_PRESETS = [
  'generic',
  'google',
  'microsoft',
  'okta',
  'keycloak',
] as const satisfies readonly Preset[];

export const NAME_ID_FORMATS = [
  'persistent',
  'emailAddress',
  'unspecified',
] as const satisfies readonly NameIdFormat[];

/** 列表上的協定標籤：SAML 另外處理，OIDC 顯示範本名稱。 */
export const KIND_LABEL_KEY = {
  generic: 'identityProvider.protocol.oidc',
  google: 'identityProvider.preset.google',
  microsoft: 'identityProvider.preset.microsoft',
  okta: 'identityProvider.preset.okta',
  keycloak: 'identityProvider.preset.keycloak',
} as const satisfies Record<Preset, string>;

export const DEFAULT_SCOPES = 'openid email profile';
const GOOGLE_ISSUER = 'https://accounts.google.com';
const MICROSOFT_ISSUER = /^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0$/;
const DIRECTORY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 與後端 `oidc-presets.ts` 的 issuer 格式相同（後端會再檢查一次）。 */
const ISSUER_PATTERN: Partial<Record<Preset, RegExp>> = {
  okta: /^https:\/\/[a-z0-9.-]+(\/oauth2\/[A-Za-z0-9]+)?$/,
  keycloak: /^https?:\/\/[^\s?#]+\/realms\/[^/\s?#]+$/,
};

/** 與後端 `DomainSchema` 相同。 */
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export interface DomainRow extends IdentityProviderDomain {
  /** 列的穩定 key（網域本身會被編輯）。 */
  key: number;
}

export interface IdentityProviderForm {
  protocol: Protocol;
  name: string;
  enabled: boolean;
  unmatchedPolicy: UnmatchedPolicy;
  domains: DomainRow[];
  // OIDC
  preset: Preset;
  issuer: string;
  /** Entra 的目錄（租戶）ID：issuer 由它組成。 */
  directoryId: string;
  clientId: string;
  /** 留空：建立時必填、編輯時表示不變更。 */
  clientSecret: string;
  scopes: string;
  // SAML
  entityId: string;
  ssoUrl: string;
  /** 一張一個欄位（PEM）。 */
  certificates: string[];
  nameIdFormat: NameIdFormat;
  emailAttribute: string;
  nameAttribute: string;
}

export function initialForm(provider?: IdentityProvider): IdentityProviderForm {
  const saml = provider?.saml;
  const isSaml = provider?.protocol === 'saml';
  return {
    protocol: provider?.protocol ?? 'oidc',
    name: provider?.name ?? '',
    enabled: provider?.enabled ?? true,
    unmatchedPolicy: provider?.unmatchedPolicy ?? 'reject',
    domains: (provider?.domains ?? []).map(({ domain, ssoOnly }, index) => ({
      domain,
      ssoOnly,
      key: index,
    })),
    preset: provider?.preset ?? 'generic',
    issuer: !isSaml ? (provider?.issuer ?? '') : '',
    directoryId: (!isSaml && MICROSOFT_ISSUER.exec(provider?.issuer ?? '')?.[1]) || '',
    clientId: provider?.clientId ?? '',
    clientSecret: '',
    scopes: provider?.scopes ?? DEFAULT_SCOPES,
    entityId: isSaml ? (provider?.issuer ?? '') : '',
    ssoUrl: saml?.ssoUrl ?? '',
    certificates: saml?.certificates.map((item) => item.pem) ?? [''],
    nameIdFormat: saml?.nameIdFormat ?? 'persistent',
    emailAttribute: saml?.emailAttribute ?? '',
    nameAttribute: saml?.nameAttribute ?? '',
  };
}

/** 範本決定 issuer：Google 固定、Entra 由目錄 ID 組成，其他照輸入。 */
export function issuerOf(form: Pick<IdentityProviderForm, 'preset' | 'issuer' | 'directoryId'>) {
  if (form.preset === 'google') return GOOGLE_ISSUER;
  if (form.preset === 'microsoft') {
    return `https://login.microsoftonline.com/${form.directoryId.trim().toLowerCase()}/v2.0`;
  }
  return form.issuer.trim();
}

function isUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function domainError(
  rows: readonly DomainRow[],
  row: DomainRow,
): 'invalid' | 'duplicate' | undefined {
  const domain = row.domain.trim().toLowerCase();
  if (!DOMAIN_PATTERN.test(domain)) return 'invalid';
  const same = rows.filter((other) => other.domain.trim().toLowerCase() === domain);
  return same.length > 1 && same[0] !== row ? 'duplicate' : undefined;
}

/** 看起來像 PEM 或 base64 的憑證（格式由後端以 X.509 檢查）。 */
function looksLikeCertificate(value: string): boolean {
  const body = value.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
  return body.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(body);
}

export interface FormErrors {
  name?: boolean;
  issuer?: boolean;
  directoryId?: boolean;
  clientId?: boolean;
  clientSecret?: boolean;
  scopes?: boolean;
  domains?: boolean;
  entityId?: boolean;
  ssoUrl?: boolean;
  /** 不對的憑證的位置。 */
  certificates?: number[];
}

/** 前端先擋明顯的錯誤；`editing` 時 client secret 可以留空。 */
export function validateForm(form: IdentityProviderForm, editing: boolean): FormErrors {
  const errors: FormErrors = {
    name: !form.name.trim(),
    domains: form.domains.some((row) => domainError(form.domains, row)),
  };
  if (form.protocol === 'oidc') {
    const issuer = issuerOf(form);
    const pattern = ISSUER_PATTERN[form.preset];
    errors.directoryId =
      form.preset === 'microsoft' && !DIRECTORY_ID.test(form.directoryId.trim().toLowerCase());
    errors.issuer =
      form.preset !== 'microsoft' &&
      form.preset !== 'google' &&
      (!isUrl(issuer) || (pattern !== undefined && !pattern.test(issuer)));
    errors.clientId = !form.clientId.trim();
    errors.clientSecret = !editing && !form.clientSecret;
    errors.scopes = !form.scopes.trim().split(/\s+/).includes('openid');
  } else {
    errors.entityId = !form.entityId.trim();
    errors.ssoUrl = !isUrl(form.ssoUrl.trim());
    const bad = form.certificates.flatMap((pem, index) =>
      looksLikeCertificate(pem) ? [] : [index],
    );
    if (bad.length > 0) errors.certificates = bad;
  }
  return errors;
}

export function hasErrors(errors: FormErrors): boolean {
  return Object.values(errors).some((value) => (Array.isArray(value) ? value.length > 0 : value));
}

function commonBody(form: IdentityProviderForm) {
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    unmatchedPolicy: form.unmatchedPolicy,
    domains: form.domains.map(({ domain, ssoOnly }) => ({
      domain: domain.trim().toLowerCase(),
      ssoOnly,
    })),
  };
}

function samlBody(form: IdentityProviderForm) {
  return {
    protocol: 'saml' as const,
    entityId: form.entityId.trim(),
    ssoUrl: form.ssoUrl.trim(),
    certificates: form.certificates.map((pem) => pem.trim()),
    nameIdFormat: form.nameIdFormat,
    emailAttribute: form.emailAttribute.trim() || null,
    nameAttribute: form.nameAttribute.trim() || null,
  };
}

function oidcBody(form: IdentityProviderForm) {
  return {
    protocol: 'oidc' as const,
    preset: form.preset,
    issuer: issuerOf(form),
    clientId: form.clientId.trim(),
    scopes: form.scopes.trim().split(/\s+/).join(' '),
  };
}

export function toCreateRequest(form: IdentityProviderForm): CreateIdentityProviderRequest {
  return form.protocol === 'saml'
    ? { ...commonBody(form), ...samlBody(form) }
    : { ...commonBody(form), ...oidcBody(form), clientSecret: form.clientSecret };
}

/** 整份送出（後端只更新有給的欄位，值相同時不影響）；client secret 留空表示不變更。 */
export function toUpdateRequest(form: IdentityProviderForm): UpdateIdentityProviderRequest {
  return form.protocol === 'saml'
    ? { ...commonBody(form), ...samlBody(form) }
    : {
        ...commonBody(form),
        ...oidcBody(form),
        ...(form.clientSecret && { clientSecret: form.clientSecret }),
      };
}

/** 與開啟時相比有沒有改動（Esc、點遮罩、取消、換頁之前先確認）。 */
export function isFormDirty(form: IdentityProviderForm, initial: IdentityProviderForm): boolean {
  const comparable = (value: IdentityProviderForm) =>
    JSON.stringify({
      ...value,
      domains: value.domains.map(({ domain, ssoOnly }) => ({ domain, ssoOnly })),
    });
  return comparable(form) !== comparable(initial);
}
