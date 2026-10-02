import { z } from 'zod';

/** `.catch()` 而非 `.default()`：使用者手改網址成 ?limit=abc 時退回預設值，不變成錯誤頁。 */
export const WebhookSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(200).catch(20),
  keyword: z.string().trim().optional().catch(undefined),
  status: z.enum(['active', 'disabled']).optional().catch(undefined),
});

export type WebhookSearchQuery = z.infer<typeof WebhookSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_WEBHOOK_SEARCH: WebhookSearchQuery = { offset: 0, limit: 20 };
