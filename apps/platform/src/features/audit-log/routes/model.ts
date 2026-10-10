import { z } from 'zod/mini';

export const AuditLogSearchQuerySchema = z.object({
  offset: z.catch(z.coerce.number().check(z.int(), z.minimum(0)), 0),
  limit: z.catch(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(100)), 50),
  action: z.catch(z.optional(z.string().check(z.trim())), undefined),
  actorEmail: z.catch(z.optional(z.string().check(z.trim())), undefined),
  result: z.catch(z.optional(z.enum(['success', 'failure'])), undefined),
  /** 使用者當地的日曆日（`YYYY-MM-DD`）；查詢時才換成時區的日界線 */
  from: z.catch(z.optional(z.string()), undefined),
  to: z.catch(z.optional(z.string()), undefined),
});

export type AuditLogSearchQuery = z.infer<typeof AuditLogSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_AUDIT_LOG_SEARCH: AuditLogSearchQuery = {
  offset: 0,
  limit: 50,
};
