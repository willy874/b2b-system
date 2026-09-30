import { z } from 'zod';

export const AuditLogSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(100).catch(50),
  action: z.string().trim().optional().catch(undefined),
  actorEmail: z.string().trim().optional().catch(undefined),
  result: z.enum(['success', 'failure']).optional().catch(undefined),
});

export type AuditLogSearchQuery = z.infer<typeof AuditLogSearchQuerySchema>;

/** 預設的查詢條件；與它相等的參數不寫進網址（`stripSearchParams`，見 routes/pages.ts）。 */
export const DEFAULT_AUDIT_LOG_SEARCH: AuditLogSearchQuery = {
  offset: 0,
  limit: 50,
};
