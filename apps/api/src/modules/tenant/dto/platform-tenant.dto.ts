import { z } from 'zod';

import { defineSchema } from '@/core/validation';

/**
 * 租戶代碼：網域的第一段（`{code}.<TENANT_BASE_DOMAIN>`）與「進入租戶」頁輸入的值，
 * 所以只能是小寫英數與連字號，3–32 字元，開頭是字母。
 */
export const TENANT_CODE_PATTERN = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

/** 不能當租戶代碼：會與部署用的子網域撞在一起。 */
export const RESERVED_TENANT_CODES: ReadonlySet<string> = new Set([
  'api',
  'auth',
  'www',
  'admin',
  'platform',
  'static',
  'storage',
  'mail',
]);

/** 瀏覽器看到的 host：主機名稱，可以帶 port（開發環境的 `acme.localhost:5173`）。 */
const HOST_PATTERN =
  /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

export const TenantDomainSchema = z.string().trim().toLowerCase().regex(HOST_PATTERN, 'domain');

export const TenantStatusSchema = z.enum(['provisioning', 'active', 'disabled', 'failed']);

/** 平台管理者看到的租戶（docs/adr/0020-physical-tenant-isolation.md D12、D13）：不含連線字串。 */
export const PlatformTenantSchema = defineSchema(
  'PlatformTenant',
  z.object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    status: TenantStatusSchema,
    /** 第一個是主要網域：信中的連結、進入租戶都用它。 */
    domains: z.array(z.string()),
    storageBucket: z.string(),
    /** 是否允許租戶設定外部 IdP 連線（D22）。 */
    allowExternalIdp: z.boolean(),
    /** 佈建時建立的第一位管理員；`db:migrate` 登記的租戶沒有。 */
    adminEmail: z.string().nullable(),
    /** 最近一次佈建失敗的原因（`failed` 時才有）。 */
    provisionError: z.string().nullable(),
    provisionedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const PlatformTenantListSchema = defineSchema(
  'PlatformTenantList',
  z.object({
    items: z.array(PlatformTenantSchema),
    /** 建立時預設網域的上層：租戶 `acme` 的預設網域是 `acme.<baseDomain>`。 */
    baseDomain: z.string(),
  }),
);

export const CreateTenantSchema = defineSchema(
  'CreateTenantRequest',
  z.object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(TENANT_CODE_PATTERN, 'code')
      .refine((code) => !RESERVED_TENANT_CODES.has(code), 'reserved'),
    name: z.string().trim().min(1).max(100),
    adminEmail: z.string().trim().toLowerCase().email().max(254),
    adminName: z.string().trim().min(1).max(100).optional(),
    /** 額外的網域（客戶自己的網域）；預設網域一定會建立，而且是主要網域。 */
    domains: z.array(TenantDomainSchema).max(10).default([]),
  }),
);

export const UpdateTenantSchema = defineSchema(
  'UpdateTenantRequest',
  z
    .object({
      name: z.string().trim().min(1).max(100).optional(),
      allowExternalIdp: z.boolean().optional(),
    })
    .refine((dto) => dto.name !== undefined || dto.allowExternalIdp !== undefined, 'empty'),
);

export const AddTenantDomainSchema = defineSchema(
  'AddTenantDomainRequest',
  z.object({ domain: TenantDomainSchema }),
);

export type PlatformTenantDto = z.infer<typeof PlatformTenantSchema>;
export type PlatformTenantListDto = z.infer<typeof PlatformTenantListSchema>;
export type CreateTenantDto = z.infer<typeof CreateTenantSchema>;
export type UpdateTenantDto = z.infer<typeof UpdateTenantSchema>;
export type AddTenantDomainDto = z.infer<typeof AddTenantDomainSchema>;
