import { z } from 'zod';

import { TENANT_FEATURES } from '@/core/tenant';
import { defineSchema, uniqueItems } from '@/core/validation';

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

/**
 * 可由平台管理者開關的 feature id（docs/adr/0021-runtime-feature-activation.md D8）：以 `TenantFeature` 出現在 OpenAPI，
 * 前端由 api-sdk 取得型別與常數（與權限鍵同一個做法，ADR-0007）。
 */
export const TenantFeatureSchema = defineSchema('TenantFeature', z.enum(TENANT_FEATURES));

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
    /** 啟用的 feature（ADR-0021 D8），依 `TENANT_FEATURES` 的順序。 */
    features: z.array(TenantFeatureSchema),
    /** 佈建時建立的第一位管理員；`db:migrate` 登記的租戶沒有。 */
    adminEmail: z.string().nullable(),
    /** 最近一次佈建失敗的原因（`failed` 時才有）。 */
    provisionError: z.string().nullable(),
    provisionedAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

/** 租戶清單的查詢：伺服器分頁、代碼／名稱／網域搜尋、狀態篩選（依建立時間舊到新）。 */
export const ListPlatformTenantSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** 代碼、名稱或任一網域的部分相符（不分大小寫）。 */
  q: z.string().trim().max(100).optional(),
  status: TenantStatusSchema.optional(),
});

export const PlatformTenantListSchema = defineSchema(
  'PlatformTenantList',
  z.object({
    items: z.array(PlatformTenantSchema),
    pagination: z.object({ offset: z.number(), limit: z.number(), total: z.number() }),
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
      /**
       * 啟用的 feature 的 **完整清單**（不是增減）：沒列出的就停用，空陣列 = 全部停用（ADR-0021 D8）。
       * 重複的值與其他陣列欄位一樣直接拒絕（`uniqueItems`），所以長度上限就是 id 的總數。
       */
      features: uniqueItems(z.array(TenantFeatureSchema).max(TENANT_FEATURES.length)).optional(),
    })
    .refine(
      (dto) =>
        dto.name !== undefined || dto.allowExternalIdp !== undefined || dto.features !== undefined,
      'empty',
    ),
);

export const AddTenantDomainSchema = defineSchema(
  'AddTenantDomainRequest',
  z.object({ domain: TenantDomainSchema }),
);

export type PlatformTenantDto = z.infer<typeof PlatformTenantSchema>;
export type PlatformTenantListDto = z.infer<typeof PlatformTenantListSchema>;
export type ListPlatformTenantDto = z.infer<typeof ListPlatformTenantSchema>;
export type CreateTenantDto = z.infer<typeof CreateTenantSchema>;
export type UpdateTenantDto = z.infer<typeof UpdateTenantSchema>;
export type AddTenantDomainDto = z.infer<typeof AddTenantDomainSchema>;
