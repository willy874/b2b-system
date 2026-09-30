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

const ScopesSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value.split(/\s+/).includes('openid'), {
    message: 'scopes must include openid',
  });

export const IdentityProviderDomainSchema = defineSchema(
  'IdentityProviderDomain',
  z.object({
    domain: DomainSchema,
    /** 這個網域的帳號不能用密碼登入、不能申請重設密碼（docs/adr/0019-sso-identity-platform.md D9）。 */
    ssoOnly: z.boolean(),
  }),
);

/** client secret 不回傳（只寫不讀）。 */
export const IdentityProviderSchema = defineSchema(
  'IdentityProvider',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    issuer: z.string(),
    clientId: z.string(),
    scopes: z.string(),
    enabled: z.boolean(),
    unmatchedPolicy: UnmatchedPolicySchema,
    domains: z.array(IdentityProviderDomainSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const IdentityProviderListSchema = defineSchema(
  'IdentityProviderList',
  z.object({
    items: z.array(IdentityProviderSchema),
    /** 要登記在外部 IdP 的 redirect URI（所有連線共用一個）。 */
    callbackUrl: z.string().url(),
    /** 平台管理者是否允許這個租戶使用外部 IdP；`false` 時不能新增或啟用連線（ADR-0020 開放問題 2）。 */
    allowed: z.boolean(),
  }),
);

export const CreateIdentityProviderSchema = defineSchema(
  'CreateIdentityProviderRequest',
  z.object({
    name: z.string().trim().min(1).max(64),
    issuer: z.string().trim().url().max(500),
    clientId: z.string().trim().min(1).max(255),
    clientSecret: z.string().min(1).max(2000),
    scopes: ScopesSchema.default('openid email profile'),
    enabled: z.boolean().default(true),
    unmatchedPolicy: UnmatchedPolicySchema.default('reject'),
    domains: z.array(IdentityProviderDomainSchema).max(50).default([]),
  }),
);

/** 全部選填；`clientSecret` 有給才更換，`domains` 有給就整批取代。 */
export const UpdateIdentityProviderSchema = defineSchema(
  'UpdateIdentityProviderRequest',
  z
    .object({
      name: z.string().trim().min(1).max(64).optional(),
      issuer: z.string().trim().url().max(500).optional(),
      clientId: z.string().trim().min(1).max(255).optional(),
      clientSecret: z.string().min(1).max(2000).optional(),
      scopes: ScopesSchema.optional(),
      enabled: z.boolean().optional(),
      unmatchedPolicy: UnmatchedPolicySchema.optional(),
      domains: z.array(IdentityProviderDomainSchema).max(50).optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'at least one field is required',
    }),
);

export type IdentityProviderDto = z.infer<typeof IdentityProviderSchema>;
export type IdentityProviderListDto = z.infer<typeof IdentityProviderListSchema>;
export type IdentityProviderDomainDto = z.infer<typeof IdentityProviderDomainSchema>;
export type CreateIdentityProviderDto = z.infer<typeof CreateIdentityProviderSchema>;
export type UpdateIdentityProviderDto = z.infer<typeof UpdateIdentityProviderSchema>;
