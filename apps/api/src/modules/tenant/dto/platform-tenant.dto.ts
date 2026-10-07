import { z } from 'zod';

import { FEATURE_FLAG_KEY_PATTERN } from '@/core/feature-flags';
import { OffsetSchema } from '@/core/http';
import {
  TENANT_FEATURE_IMPACT_KEYS,
  TENANT_FEATURE_PARAM_KEYS,
  TENANT_FEATURE_PARAM_UNITS,
  TENANT_FEATURES,
} from '@/core/tenant';
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
 * 可由平台管理者開關的 feature id（docs/architecture/frontend/02-plugin-system.md §9.2 D8）：以 `TenantFeature` 出現在 OpenAPI，
 * 前端由 api-sdk 取得型別與常數（與權限鍵同一個做法，docs/architecture/backend/03-api-conventions.md §12）。
 */
export const TenantFeatureSchema = defineSchema('TenantFeature', z.enum(TENANT_FEATURES));

/**
 * 租戶層的 feature flag 覆寫（docs/architecture/05-tenancy.md §11.2 D2）：`{ [key]: boolean }`，沒列出 = 不覆寫。
 * key 在 OpenAPI 上是字串（目錄常常是空的，空 enum 產不出可用的型別），由伺服器依目錄驗證。
 */
export const TenantFlagOverridesSchema = defineSchema(
  'TenantFlagOverrides',
  z.record(z.string().regex(FEATURE_FLAG_KEY_PATTERN).max(100), z.boolean()),
);

/** feature 參數的 key（docs/architecture/05-tenancy.md §13.2 D1）：前端以它對照語系。 */
export const TenantFeatureParamKeySchema = defineSchema(
  'TenantFeatureParamKey',
  z.enum(TENANT_FEATURE_PARAM_KEYS),
);

/**
 * 一個 feature 參數在這個租戶的生效值與定義（docs/architecture/05-tenancy.md §13.2 D3）。整數有 `min`／`max`／`unit`，字串有 `maxLength`；
 * 不適用的欄位是 `null`。
 */
export const TenantFeatureParamSchema = defineSchema(
  'TenantFeatureParam',
  z.object({
    key: TenantFeatureParamKeySchema,
    /** `null`：不屬於任何 feature、對整個租戶生效的限制。 */
    feature: TenantFeatureSchema.nullable(),
    type: z.enum(['integer', 'string']),
    value: z.union([z.number(), z.string()]),
    defaultValue: z.union([z.number(), z.string()]),
    /** 有覆寫值（`value` 不是預設值）。 */
    overridden: z.boolean(),
    unit: z.enum(TENANT_FEATURE_PARAM_UNITS).nullable(),
    min: z.number().nullable(),
    max: z.number().nullable(),
    maxLength: z.number().nullable(),
  }),
);

/**
 * 要改的 feature 參數（docs/architecture/05-tenancy.md §13.2 D3）：**只列要改的**，`null` 回到預設值。型別與範圍由伺服器依目錄驗證
 * （`VALIDATION_FAILED`，`fields["featureParams.<key>"]`）。
 */
export const UpdateTenantFeatureParamsSchema = z
  .partialRecord(
    TenantFeatureParamKeySchema,
    z.union([z.number(), z.string().max(1000)]).nullable(),
  )
  .refine((value) => Object.keys(value).length > 0, 'empty');

/** 平台管理者看到的租戶（docs/architecture/05-tenancy.md §10.2 D12、D13）：不含連線字串。 */
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
    /** 啟用的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D8），依 `TENANT_FEATURES` 的順序。 */
    features: z.array(TenantFeatureSchema),
    /** feature flag 的租戶層覆寫（docs/architecture/05-tenancy.md §11.2 D2），只含目錄裡有的 key。 */
    flags: TenantFlagOverridesSchema,
    /** feature 參數（docs/architecture/05-tenancy.md §13.2 D3），依目錄的順序，已是生效值。 */
    featureParams: z.array(TenantFeatureParamSchema),
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
  offset: OffsetSchema,
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
      /**
       * 啟用的 feature 的 **完整清單**（不是增減）：沒列出的就停用，空陣列 = 全部停用（docs/architecture/frontend/02-plugin-system.md §9.2 D8）。
       * 重複的值與其他陣列欄位一樣直接拒絕（`uniqueItems`），所以長度上限就是 id 的總數。
       */
      features: uniqueItems(z.array(TenantFeatureSchema).max(TENANT_FEATURES.length)).optional(),
      /**
       * feature flag 覆寫的 **完整表**（取代而非增減；docs/architecture/05-tenancy.md §11.2 D7）：沒列出的 key 回到全平台層與預設值，
       * `{}` = 全部不覆寫。不在目錄裡的 key 回 `VALIDATION_FAILED`。
       */
      flags: TenantFlagOverridesSchema.optional(),
      featureParams: UpdateTenantFeatureParamsSchema.optional(),
    })
    .refine(
      (dto) =>
        dto.name !== undefined ||
        dto.features !== undefined ||
        dto.flags !== undefined ||
        dto.featureParams !== undefined,
      'empty',
    ),
);

/** 關閉一個 feature 會影響的數量（平台管理者關閉前的確認框）。 */
export const TenantFeatureImpactSchema = defineSchema(
  'TenantFeatureImpact',
  z.object({
    feature: TenantFeatureSchema,
    /** false = 現在進不了這個租戶的 DB（佈建中、migration 落後、連不上）：只能顯示一般的說明。 */
    available: z.boolean(),
    /** 有登記計數的 feature 才有；沒有登記時是空陣列。 */
    items: z.array(
      z.object({ key: z.enum(TENANT_FEATURE_IMPACT_KEYS), count: z.number().int().min(0) }),
    ),
  }),
);

export const AddTenantDomainSchema = defineSchema(
  'AddTenantDomainRequest',
  z.object({ domain: TenantDomainSchema }),
);

export type PlatformTenantDto = z.infer<typeof PlatformTenantSchema>;
export type TenantFeatureParamDto = z.infer<typeof TenantFeatureParamSchema>;
export type PlatformTenantListDto = z.infer<typeof PlatformTenantListSchema>;
export type ListPlatformTenantDto = z.infer<typeof ListPlatformTenantSchema>;
export type CreateTenantDto = z.infer<typeof CreateTenantSchema>;
export type UpdateTenantDto = z.infer<typeof UpdateTenantSchema>;
export type AddTenantDomainDto = z.infer<typeof AddTenantDomainSchema>;
export type TenantFeatureImpactDto = z.infer<typeof TenantFeatureImpactSchema>;
