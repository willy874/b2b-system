import { z } from 'zod';

import { defineSchema } from '@/core/validation';

export const ListAuditLogSchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  actorId: z.string().uuid().optional(),
  action: z.string().max(100).optional(), // 支援前綴比對：`role.*`
  resourceType: z.string().max(50).optional(),
  resourceId: z.string().max(100).optional(),
  result: z.enum(['success', 'failure']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListAuditLogDto = z.infer<typeof ListAuditLogSchema>;

export const AuditLogSchema = defineSchema(
  'AuditLog',
  z.object({
    id: z.string(),
    occurredAt: z.string(),
    actorId: z.string().nullable(),
    actorEmail: z.string(),
    action: z.string(),
    resourceType: z.string(),
    resourceId: z.string().nullable(),
    resourceName: z.string().nullable(),
    result: z.enum(['success', 'failure']),
    errorCode: z.string().nullable(),
    changes: z.record(z.string(), z.unknown()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  }),
);

export type AuditLogDto = z.infer<typeof AuditLogSchema>;
