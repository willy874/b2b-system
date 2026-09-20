import { z } from 'zod';

export const AuditLogSearchQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).catch(0),
  limit: z.coerce.number().int().min(1).max(100).catch(50),
  action: z.string().trim().optional().catch(undefined),
  resourceType: z.string().trim().optional().catch(undefined),
  result: z.enum(['success', 'failure']).optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
});

export type AuditLogSearchQuery = z.infer<typeof AuditLogSearchQuerySchema>;
