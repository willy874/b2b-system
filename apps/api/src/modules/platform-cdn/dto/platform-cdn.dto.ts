import { z } from 'zod';

import { JOB_STATES } from '@/core/jobs';
import { CDN_RESOURCE_TYPES } from '@/core/storage';
import { defineSchema } from '@/core/validation';

/**
 * apps/platform 的 CDN 頁面（docs/architecture/backend/09-file.md §16.9～§16.12）。存放值（`settings`）與生效值（`effective`）分開回：
 * 頁面同時顯示「設定了什麼」與「實際生效的是什麼」（超過部署的上限時兩者不同）。
 */

export const CdnResourceSchema = defineSchema('CdnResource', z.enum(CDN_RESOURCE_TYPES));
export const CdnStateSchema = defineSchema('CdnState', z.enum(['on', 'off']));

const CdnNodeProblemSchema = z.enum([
  'unreachable',
  'timeout',
  'purgeSecretRejected',
  'badResponse',
  'signingKidMissing',
  'verifyKidMissing',
]);

export const CdnCheckNodeSchema = defineSchema(
  'CdnCheckNode',
  z.object({
    address: z.string(),
    problems: z.array(CdnNodeProblemSchema),
    kids: z.array(z.string()).nullable(),
    missingKids: z.array(z.string()),
    cache: z.object({ maxSize: z.string(), inactive: z.string(), valid: z.string() }).nullable(),
    build: z.string().nullable(),
    startedAt: z.string().nullable(),
    detail: z.string().optional(),
  }),
);

export const CdnCheckResultSchema = defineSchema(
  'CdnCheckResult',
  z.object({
    checkedAt: z.string(),
    /** 開啟前必須通過的三項（連線、清理密鑰、簽發中的 kid）在每個節點都成立。 */
    ready: z.boolean(),
    discovery: z.object({
      ok: z.boolean(),
      problem: z.enum(['purgeNotConfigured', 'resolveFailed']).optional(),
      detail: z.string().optional(),
    }),
    nodes: z.array(CdnCheckNodeSchema),
    /** 項目 4：以 api 的身分簽一個不存在的路徑，預期源站的 404（只警告）。 */
    publicUrl: z.object({
      result: z.enum([
        'ok',
        'signatureRejected',
        'originAuthRejected',
        'originUnreachable',
        'unreachable',
        'unexpected',
      ]),
      status: z.number().int().optional(),
      detail: z.string().optional(),
    }),
    /** 項目 5：竄改的簽章要被拒（`notEnforced` 是最嚴重的問題，立即告警）。 */
    signatureEnforced: z.object({
      result: z.enum(['ok', 'notEnforced', 'unreachable', 'unexpected']),
      status: z.number().int().optional(),
      detail: z.string().optional(),
    }),
  }),
);

export const CdnDeploymentSchema = defineSchema(
  'CdnDeployment',
  z.object({
    /** `FILE_CDN_ENABLED`：false 時頁面只顯示這一塊與啟用的方式。 */
    deployed: z.boolean(),
    provider: z.string().nullable(),
    origin: z.string().nullable(),
    /** 簽發中的 kid（金鑰環的第一把）。 */
    signingKid: z.string().nullable(),
    /** 金鑰環上所有可驗證的 kid（含簽發中的）。 */
    kids: z.array(z.string()),
    /** `FILE_CDN_RESOURCES`：執行期只能從中選。 */
    resources: z.array(CdnResourceSchema),
    /** 效期上限的可設定範圍：`minUrlTtl`～`maxUrlTtl` 秒。 */
    minUrlTtl: z.number().int(),
    maxUrlTtl: z.number().int(),
    /** 設定了清理端點與密鑰（沒有時不能開自動清理、不能手動清理、節點檢查沒有對象）。 */
    purgeConfigured: z.boolean(),
    purgeOnDelete: z.boolean(),
    purgeBatchSize: z.number().int(),
    /** `FILE_CDN_HEALTH_CHECK_CRON`；不排程時是 null。 */
    healthCheckCron: z.string().nullable(),
  }),
);

export const CdnStoredSettingsSchema = defineSchema(
  'CdnStoredSettings',
  z.object({
    /** null = 沒有覆寫（跟著環境變數，等於 `on`）。 */
    state: CdnStateSchema.nullable(),
    /** 存放的值（可能含部署已不開放、或這一版不認得的資源類型）。 */
    resources: z.array(z.string()).nullable(),
    urlTtlCap: z.number().int().nullable(),
    purgeOnDelete: z.boolean().nullable(),
    purgeBatchSize: z.number().int().nullable(),
    stateChangedAt: z.string().nullable(),
    stateChangedBy: z.object({ id: z.string(), email: z.string().nullable() }).nullable(),
    /** 樂觀鎖：沒有列時是 1。 */
    version: z.number().int(),
    updatedAt: z.string().nullable(),
  }),
);

export const CdnEffectiveSchema = defineSchema(
  'CdnEffective',
  z.object({
    serving: z.boolean(),
    resources: z.array(CdnResourceSchema),
    urlTtlCap: z.number().int(),
    purgeOnDelete: z.boolean(),
    purgeBatchSize: z.number().int(),
    /** 存放值超過部署的上限而被裁切的部分。 */
    clamped: z.object({ resources: z.array(CdnResourceSchema), urlTtlCap: z.boolean() }),
    /** 執行期關閉時：關閉前發出的 CDN 網址最晚何時過期（在那之前邊緣仍要運作）。 */
    issuedUrlsExpireAt: z.string().nullable(),
  }),
);

export const CdnPurgeJobSummarySchema = defineSchema(
  'CdnPurgeJobSummary',
  z.object({
    id: z.string(),
    state: z.enum(JOB_STATES),
    createdOn: z.string(),
    completedOn: z.string().nullable(),
    /** 路徑數；整個快取是 `all`。 */
    paths: z.union([z.number().int(), z.literal('all')]),
    /** 手動清理的來源；物件刪除後的自動清理是 null。 */
    manual: z
      .object({
        requestedBy: z.string(),
        tenantId: z.string().nullable(),
        target: z.string(),
        id: z.string().optional(),
      })
      .nullable(),
  }),
);

export const CdnOverviewSchema = defineSchema(
  'CdnOverview',
  z.object({
    deployment: CdnDeploymentSchema,
    /** 沒有部署 CDN 時是 null。 */
    settings: CdnStoredSettingsSchema.nullable(),
    effective: CdnEffectiveSchema.nullable(),
    lastCheck: CdnCheckResultSchema.nullable(),
    /** 最近 20 筆 `cdn.purge`（手動與自動）。 */
    recentPurges: z.array(CdnPurgeJobSummarySchema),
    /** 可以依資源清理的資源類型（有登記路徑解析器的）。 */
    purgeTargets: z.array(CdnResourceSchema),
  }),
);

export type CdnOverviewDto = z.infer<typeof CdnOverviewSchema>;
export type CdnCheckResultDto = z.infer<typeof CdnCheckResultSchema>;

/** 只帶要改的欄位與 `version`；`null` = 回到「跟著環境變數」。 */
export const UpdateCdnSettingsSchema = defineSchema(
  'UpdateCdnSettingsRequest',
  z.object({
    version: z.number().int().min(1),
    state: CdnStateSchema.nullable().optional(),
    resources: z.array(CdnResourceSchema).max(CDN_RESOURCE_TYPES.length).nullable().optional(),
    urlTtlCap: z.number().int().nullable().optional(),
    purgeOnDelete: z.boolean().nullable().optional(),
    purgeBatchSize: z.number().int().min(1).max(1000).nullable().optional(),
  }),
);

export type UpdateCdnSettingsDto = z.infer<typeof UpdateCdnSettingsSchema>;

/** bucket 裡的物件 key：不以 `/` 開頭、不含 `..`、不是空字串。 */
const ObjectKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(1024)
  .refine((key) => !key.startsWith('/') && !key.split('/').includes('..'), {
    message: 'CDN_PURGE_PATH_INVALID',
  });

export const CdnPurgeRequestSchema = defineSchema(
  'CdnPurgeRequest',
  z.object({
    target: z.discriminatedUnion('type', [
      z.object({
        type: z.literal('paths'),
        tenantId: z.string().uuid(),
        /** bucket 裡的物件 key（例：`images/<id>/r3/sm.webp`），伺服器加上那個租戶的 bucket。 */
        paths: z.array(ObjectKeySchema).min(1).max(1000),
      }),
      z.object({
        type: CdnResourceSchema,
        tenantId: z.string().uuid(),
        id: z.string().uuid(),
      }),
      z.object({ type: z.literal('all') }),
    ]),
  }),
);

export type CdnPurgeRequestDto = z.infer<typeof CdnPurgeRequestSchema>;

export const CdnPurgeResultSchema = defineSchema(
  'CdnPurgeResult',
  z.object({
    jobIds: z.array(z.string()),
    /** 排入清理的路徑數；整個快取是 `all`。 */
    paths: z.union([z.number().int(), z.literal('all')]),
  }),
);

export type CdnPurgeResultDto = z.infer<typeof CdnPurgeResultSchema>;
