import { z } from 'zod';

export const TenantSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(100).catch(50),
  q: z.string().trim().max(100).optional().catch(undefined),
  status: z.enum(['provisioning', 'active', 'disabled', 'failed']).optional().catch(undefined),
});

export type TenantSearchQuery = z.infer<typeof TenantSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_TENANT_SEARCH: TenantSearchQuery = {
  offset: 0,
  limit: 50,
};

/** 詳情頁的分頁；不認得的值（舊連結、手打）回到概覽。 */
export const TENANT_DETAIL_TABS = ['overview', 'features', 'flags', 'mfa'] as const;

export type TenantDetailTab = (typeof TENANT_DETAIL_TABS)[number];

export const TenantDetailSearchSchema = z.object({
  tab: z.enum(TENANT_DETAIL_TABS).catch('overview'),
});

export type TenantDetailSearch = z.infer<typeof TenantDetailSearchSchema>;

/** 概覽是預設分頁，不寫進網址（`stripSearchParams`）。 */
export const DEFAULT_TENANT_DETAIL_SEARCH: TenantDetailSearch = { tab: 'overview' };
