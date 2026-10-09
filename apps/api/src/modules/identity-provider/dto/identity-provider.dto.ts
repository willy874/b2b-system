import { z } from 'zod';

import { defineSchema } from '@/core/validation';

/** 小寫網域（不含 `@`、萬用字元）；citext 欄位本身也不分大小寫。 */
const DomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/);

export const UnmatchedPolicySchema = z.enum(['reject', 'auto_create']);

export const IdentityProviderProtocolSchema = z.enum(['oidc', 'saml']);

/** OIDC 連線的範本（docs/architecture/04-sso.md §3.3.1）；SAML 一律是 `generic`。 */
export const IdentityProviderPresetSchema = z.enum([
  'generic',
  'google',
  'microsoft',
  'okta',
  'keycloak',
]);

export const SamlNameIdFormatSchema = z.enum(['persistent', 'emailAddress', 'unspecified']);

const ScopesSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value.split(/\s+/).includes('openid'), {
    message: 'scopes must include openid',
  });

/** PEM 憑證（含或不含 `-----BEGIN CERTIFICATE-----`）；格式由 service 以 X509Certificate 檢查。 */
const CertificateSchema = z.string().trim().min(1).max(10_000);

/** SAML 的屬性名稱（可以是 URI）；空字串視為沒填（service 轉成 null）。 */
const AttributeNameSchema = z.string().trim().max(255).nullable();

export const IdentityProviderDomainSchema = defineSchema(
  'IdentityProviderDomain',
  z.object({
    domain: DomainSchema,
    /** 這個網域的帳號不能用密碼登入、不能申請重設密碼（docs/architecture/04-sso.md §12.2 D9）。 */
    ssoOnly: z.boolean(),
  }),
);

export const SamlCertificateSchema = defineSchema(
  'SamlCertificate',
  z.object({
    pem: z.string(),
    subject: z.string(),
    /** 到期時間（ISO 8601）：管理頁在快到期時提醒。 */
    notAfter: z.string(),
    /** SHA-256 指紋（大寫十六進位、冒號分隔）：與 IdP 的管理頁比對用。 */
    fingerprint: z.string(),
  }),
);

export const SamlSettingsSchema = defineSchema(
  'SamlSettings',
  z.object({
    ssoUrl: z.string(),
    certificates: z.array(SamlCertificateSchema),
    nameIdFormat: SamlNameIdFormatSchema,
    emailAttribute: z.string().nullable(),
    nameAttribute: z.string().nullable(),
    /** 我們這一端（SP）的 entity ID：也是 SP metadata 的網址，給 IdP 匯入。 */
    spEntityId: z.string(),
  }),
);

/** client secret 不回傳（只寫不讀）。 */
export const IdentityProviderSchema = defineSchema(
  'IdentityProvider',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    protocol: IdentityProviderProtocolSchema,
    preset: IdentityProviderPresetSchema,
    /** OIDC：issuer；SAML：IdP 的 entity ID。 */
    issuer: z.string(),
    /** 只有 OIDC 有。 */
    clientId: z.string().nullable(),
    scopes: z.string(),
    enabled: z.boolean(),
    unmatchedPolicy: UnmatchedPolicySchema,
    domains: z.array(IdentityProviderDomainSchema),
    /** 只有 SAML 有。 */
    saml: SamlSettingsSchema.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const IdentityProviderListSchema = defineSchema(
  'IdentityProviderList',
  z.object({
    items: z.array(IdentityProviderSchema),
    /** 要登記在外部 IdP 的 redirect URI（OIDC 的所有連線共用一個）。 */
    callbackUrl: z.string().url(),
    /** SAML 的 Assertion Consumer Service 網址（所有 SAML 連線共用一個）。 */
    samlAcsUrl: z.string().url(),
  }),
);

const CommonFields = {
  name: z.string().trim().min(1).max(64),
  enabled: z.boolean().default(true),
  unmatchedPolicy: UnmatchedPolicySchema.default('reject'),
  domains: z.array(IdentityProviderDomainSchema).max(50).default([]),
};

const OidcCreateSchema = z.object({
  ...CommonFields,
  /** 沒帶時是 OIDC（加入 SAML 之前的呼叫端照舊）。 */
  protocol: z.literal('oidc').default('oidc'),
  preset: IdentityProviderPresetSchema.default('generic'),
  issuer: z.string().trim().url().max(500),
  clientId: z.string().trim().min(1).max(255),
  clientSecret: z.string().min(1).max(2000),
  scopes: ScopesSchema.default('openid email profile'),
});

const SamlCreateSchema = z.object({
  ...CommonFields,
  protocol: z.literal('saml'),
  /** IdP 的 entity ID（通常是網址，也可以是 URN）。 */
  entityId: z.string().trim().min(1).max(500),
  ssoUrl: z.string().trim().url().max(2000),
  certificates: z.array(CertificateSchema).min(1).max(3),
  nameIdFormat: SamlNameIdFormatSchema.default('persistent'),
  emailAttribute: AttributeNameSchema.default(null),
  nameAttribute: AttributeNameSchema.default(null),
});

// 不用 discriminatedUnion：判別欄位必填，而 OIDC 的 protocol 有預設值（先試 OIDC，protocol 是 saml 時不符再試 SAML）
export const CreateIdentityProviderSchema = defineSchema(
  'CreateIdentityProviderRequest',
  z.union([OidcCreateSchema, SamlCreateSchema]),
);

const CommonUpdateFields = {
  name: z.string().trim().min(1).max(64).optional(),
  enabled: z.boolean().optional(),
  unmatchedPolicy: UnmatchedPolicySchema.optional(),
  domains: z.array(IdentityProviderDomainSchema).max(50).optional(),
};

const OidcUpdateSchema = z.object({
  ...CommonUpdateFields,
  protocol: z.literal('oidc').default('oidc'),
  preset: IdentityProviderPresetSchema.optional(),
  issuer: z.string().trim().url().max(500).optional(),
  clientId: z.string().trim().min(1).max(255).optional(),
  clientSecret: z.string().min(1).max(2000).optional(),
  scopes: ScopesSchema.optional(),
});

const SamlUpdateSchema = z.object({
  ...CommonUpdateFields,
  protocol: z.literal('saml'),
  entityId: z.string().trim().min(1).max(500).optional(),
  ssoUrl: z.string().trim().url().max(2000).optional(),
  certificates: z.array(CertificateSchema).min(1).max(3).optional(),
  nameIdFormat: SamlNameIdFormatSchema.optional(),
  emailAttribute: AttributeNameSchema.optional(),
  nameAttribute: AttributeNameSchema.optional(),
});

/**
 * 全部選填；`protocol` 沒帶時是 OIDC，與連線的不同回 `IDENTITY_PROVIDER_PROTOCOL_MISMATCH`（不能換協定）。
 * `clientSecret` 有給才更換，`domains`、`certificates` 有給就整批取代。
 */
export const UpdateIdentityProviderSchema = defineSchema(
  'UpdateIdentityProviderRequest',
  z
    .union([OidcUpdateSchema.strict(), SamlUpdateSchema.strict()])
    .refine((value) => Object.keys(value).length > 1, {
      message: 'at least one field is required',
    }),
);

// ── 帳號的外部身分（docs/architecture/04-sso.md §3.3.4）──────────────────

export const UserIdentitySchema = defineSchema(
  'UserIdentity',
  z.object({
    id: z.string().uuid(),
    providerId: z.string().uuid(),
    /** 連線已刪除時仍列出（之後不能再登入），名稱照舊。 */
    providerName: z.string(),
    protocol: IdentityProviderProtocolSchema,
    providerDeleted: z.boolean(),
    /** 外部 IdP 的識別碼（OIDC 的 `sub`、SAML 的 NameID）。 */
    subject: z.string(),
    email: z.string().nullable(),
    linkedAt: z.string(),
    lastLoginAt: z.string().nullable(),
  }),
);

export const UserIdentityListSchema = defineSchema(
  'UserIdentityList',
  z.object({ items: z.array(UserIdentitySchema) }),
);

export type IdentityProviderDto = z.infer<typeof IdentityProviderSchema>;
export type IdentityProviderListDto = z.infer<typeof IdentityProviderListSchema>;
export type IdentityProviderDomainDto = z.infer<typeof IdentityProviderDomainSchema>;
export type CreateIdentityProviderDto = z.infer<typeof CreateIdentityProviderSchema>;
export type UpdateIdentityProviderDto = z.infer<typeof UpdateIdentityProviderSchema>;
export type SamlSettingsDto = z.infer<typeof SamlSettingsSchema>;
export type UserIdentityDto = z.infer<typeof UserIdentitySchema>;
export type UserIdentityListDto = z.infer<typeof UserIdentityListSchema>;
