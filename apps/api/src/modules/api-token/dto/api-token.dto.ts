import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { PermissionKeySchema } from '@/modules/permission/dto/permission.dto';

import { API_TOKEN_MAX_LIFETIME_DAYS, API_TOKEN_MAX_SCOPES } from '../api-token.constants';

/**
 * token 目前的狀態（由欄位算出，不存）：
 * - `invalidated`：帳號的 `token_version` 變了（改密碼、被重設、強制登出、停用、刪除；D5）
 */
export const ApiTokenStatusSchema = z.enum(['active', 'expired', 'revoked', 'invalidated']);

export const ApiTokenSchema = defineSchema(
  'ApiToken',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    /** 開頭到 secret 的前 4 碼，用來辨認是哪一把；完整的 token 只在建立時回傳一次。 */
    prefix: z.string(),
    /** 限縮到的權限鍵；null＝跟著帳號（D3）。 */
    scopes: z.array(PermissionKeySchema).nullable(),
    status: ApiTokenStatusSchema,
    expiresAt: z.string(),
    lastUsedAt: z.string().nullable(),
    revokedAt: z.string().nullable(),
    createdAt: z.string(),
    /** 建立者；替服務帳號建立的 token 是管理者，個人 token 是本人。 */
    createdBy: z.object({ id: z.string().uuid(), displayName: z.string() }).nullable(),
  }),
);

export const ApiTokenListSchema = defineSchema(
  'ApiTokenList',
  z.object({ items: z.array(ApiTokenSchema) }),
);

export const CreateApiTokenSchema = defineSchema(
  'CreateApiTokenRequest',
  z.object({
    name: z.string().trim().min(1).max(100),
    /** 幾天後到期；上限是平台上限與租戶設定較小的那個（個人 90、服務帳號 365，D8）。 */
    expiresInDays: z.number().int().min(1).max(API_TOKEN_MAX_LIFETIME_DAYS.service),
    /** 只給這些權限鍵（含它們的子能力與依賴）；省略或 null＝跟著帳號。 */
    scopes: z
      .array(PermissionKeySchema)
      .min(1)
      .max(API_TOKEN_MAX_SCOPES)
      .refine((keys) => new Set(keys).size === keys.length, { message: 'duplicate scopes' })
      .nullable()
      .optional(),
  }),
);

/** `POST` 的回應：`token` 只出現這一次，資料庫只存雜湊。 */
export const CreatedApiTokenSchema = defineSchema(
  'CreatedApiToken',
  z.object({ token: z.string(), apiToken: ApiTokenSchema }),
);

export type ApiTokenDto = z.infer<typeof ApiTokenSchema>;
export type ApiTokenStatus = z.infer<typeof ApiTokenStatusSchema>;
export type CreateApiTokenDto = z.infer<typeof CreateApiTokenSchema>;
export type CreatedApiTokenDto = z.infer<typeof CreatedApiTokenSchema>;

/** `GET /v1/me`（對外 API）：這把 token 是誰、能做什麼、什麼時候到期（docs/architecture/06-external-api.md §9.2 D14）。 */
export const ExternalMeSchema = defineSchema(
  'ExternalMe',
  z.object({
    account: z.object({
      id: z.string().uuid(),
      kind: z.enum(['human', 'service']),
      name: z.string(),
      /** 服務帳號沒有 email（存的是不可投遞的佔位值，不回傳）。 */
      email: z.string().nullable(),
    }),
    token: z.object({
      id: z.string().uuid(),
      name: z.string(),
      prefix: z.string(),
      scopes: z.array(PermissionKeySchema).nullable(),
      expiresAt: z.string(),
    }),
    /** 這把 token 實際取得的權限鍵：帳號的權限 ∩ scopes（含依賴樹的閉包；super-admin 展開成全集）。 */
    permissions: z.array(PermissionKeySchema),
  }),
);

export type ExternalMeDto = z.infer<typeof ExternalMeSchema>;
