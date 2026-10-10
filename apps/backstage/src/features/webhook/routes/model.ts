import { z } from 'zod/mini';

/** `.catch()` 而非 `.default()`：使用者手改網址成 ?limit=abc 時退回預設值，不變成錯誤頁。 */
export const WebhookSearchQuerySchema = z.object({
  offset: z.catch(z.coerce.number().check(z.int(), z.minimum(0)), 0),
  limit: z.catch(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(200)), 20),
  keyword: z.catch(z.optional(z.string().check(z.trim())), undefined),
  status: z.catch(z.optional(z.enum(['active', 'disabled'])), undefined),
});

export type WebhookSearchQuery = z.infer<typeof WebhookSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_WEBHOOK_SEARCH: WebhookSearchQuery = { offset: 0, limit: 20 };
