import { z } from 'zod';

/** flag 的目錄很小、API 不分頁：關鍵字只在前端比對，但放在網址上（重新整理、分享都保留）。 */
export const FeatureFlagSearchQuerySchema = z.object({
  keyword: z.string().trim().max(100).optional().catch(undefined),
});

export type FeatureFlagSearchQuery = z.infer<typeof FeatureFlagSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_FEATURE_FLAG_SEARCH: FeatureFlagSearchQuery = {};
