import { z } from 'zod/mini';

import { AUDIT_LOG_MAX_OFFSET } from '../constants';

export const AuditLogSearchQuerySchema = z.object({
  // 超過列表的 offset 上限（後端回 400）時回到第一頁，不留在錯誤畫面
  offset: z.catch(
    z.coerce.number().check(z.int(), z.minimum(0), z.maximum(AUDIT_LOG_MAX_OFFSET)),
    0,
  ),
  limit: z.catch(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100)), 50),
  action: z.catch(z.optional(z.string().check(z.trim())), undefined),
  resourceType: z.catch(z.optional(z.string().check(z.trim())), undefined),
  result: z.catch(z.optional(z.enum(['success', 'failure'])), undefined),
  from: z.catch(z.optional(z.string()), undefined),
  to: z.catch(z.optional(z.string()), undefined),
});

export type AuditLogSearchQuery = z.infer<typeof AuditLogSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_AUDIT_LOG_SEARCH: AuditLogSearchQuery = {
  offset: 0,
  limit: 50,
};
