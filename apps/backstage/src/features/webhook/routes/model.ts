import { keywordSearchSchema, paginationSearchShape } from '@b2b-system/web-shared/constants';
import { z } from 'zod/mini';

/** `.catch()` 而非 `.default()`：使用者手改網址成 ?limit=abc 時退回預設值，不變成錯誤頁。 */
export const WebhookSearchQuerySchema = z.object({
  ...paginationSearchShape(),
  keyword: keywordSearchSchema,
  status: z.catch(z.optional(z.enum(['active', 'disabled'])), undefined),
});

export type WebhookSearchQuery = z.infer<typeof WebhookSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_WEBHOOK_SEARCH: WebhookSearchQuery = { offset: 0, limit: 20 };
