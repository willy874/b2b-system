import { z } from 'zod';

import { defineSchema } from '@/core/validation';

/**
 * 一個租戶的用量摘要（docs/architecture/05-tenancy.md §5.4）：最近一次快照 ＋ 近期的請求數 ＋ 最後活動。
 * 還沒彙總過的租戶，快照的欄位是 `null`。
 */
export const TenantUsageSummarySchema = defineSchema(
  'TenantUsageSummary',
  z.object({
    usersActive: z.number().int().nullable(),
    usersTotal: z.number().int().nullable(),
    serviceAccounts: z.number().int().nullable(),
    storageUsedBytes: z.number().nullable(),
    storageQuotaBytes: z.number().nullable(),
    /** 已用量 ÷ 配額（可能超過 1：配額調低到已用量以下）；沒有快照或配額是 0 時為 `null`。 */
    storageUsageRatio: z.number().nullable(),
    /** 近 `recentDays` 天（含今天）的請求數，內部 api ＋ 對外 API。 */
    recentRequests: z.number().int(),
    /** 最後活動：人類使用者最後一次登入，或最後一個有對外 API 請求的日子（§14.2 D7），取較晚者。 */
    lastActivityAt: z.string().nullable(),
    /** 最近一次快照的時間。 */
    snapshotAt: z.string().nullable(),
  }),
);

/** 一天的用量（詳情頁的趨勢）。沒有資料的日子，快照欄是 `null`、計數是 0。 */
export const TenantUsageDaySchema = defineSchema(
  'TenantUsageDay',
  z.object({
    /** UTC 的日曆日 `YYYY-MM-DD`。 */
    date: z.string(),
    usersActive: z.number().int().nullable(),
    usersTotal: z.number().int().nullable(),
    serviceAccounts: z.number().int().nullable(),
    storageUsedBytes: z.number().nullable(),
    storageQuotaBytes: z.number().nullable(),
    requestsInternal: z.number().int(),
    requestsExternal: z.number().int(),
    jobsExecuted: z.number().int(),
  }),
);

export const GetTenantUsageSchema = z.object({
  /** 趨勢要幾天（含今天）。 */
  days: z.coerce.number().int().min(1).max(90).default(30),
});

export const TenantUsageSchema = defineSchema(
  'TenantUsage',
  z.object({
    summary: TenantUsageSummarySchema,
    /** 使用率達到這個比例就標成警示並通知平台管理者（§14.2 D8）。 */
    warningRatio: z.number(),
    recentDays: z.number().int(),
    /** 舊到新，每天一筆（含沒有資料的日子）。 */
    daily: z.array(TenantUsageDaySchema),
  }),
);

export type TenantUsageSummaryDto = z.infer<typeof TenantUsageSummarySchema>;
export type TenantUsageDayDto = z.infer<typeof TenantUsageDaySchema>;
export type GetTenantUsageDto = z.infer<typeof GetTenantUsageSchema>;
export type TenantUsageDto = z.infer<typeof TenantUsageSchema>;
