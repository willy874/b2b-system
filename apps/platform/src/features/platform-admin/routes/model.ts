import { z } from 'zod/mini';

/** 平台管理者數量少、API 不分頁：關鍵字只在前端比對名稱與 email，但放在網址上（重新整理、分享都保留）。 */
export const PlatformAdminSearchQuerySchema = z.object({
  keyword: z.catch(z.optional(z.string().check(z.trim(), z.maxLength(100))), undefined),
});

export type PlatformAdminSearchQuery = z.infer<typeof PlatformAdminSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_PLATFORM_ADMIN_SEARCH: PlatformAdminSearchQuery = {};
