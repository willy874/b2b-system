import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import {
  AUDIT_LOG_MAX_OFFSET,
  AUDIT_LOG_MAX_RANGE_DAYS,
  AUDIT_LOG_MAX_RANGE_MS,
} from '../audit-log.constants';

export const ListAuditLogSchema = z
  .object({
    offset: z.coerce.number().int().min(0).max(AUDIT_LOG_MAX_OFFSET).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    actorId: z.string().uuid().optional(),
    action: z.string().trim().max(100).optional(), // 支援前綴比對：`role.*`
    resourceType: z.string().trim().max(50).optional(),
    resourceId: z.string().trim().max(100).optional(),
    result: z.enum(['success', 'failure']).optional(),
    // 沒帶時由 service 補成「現在往前 90 天」（resolveAuditLogRange）
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .superRefine(({ from, to }, ctx) => {
    if (!from || !to) return;
    if (from > to) {
      ctx.addIssue({ code: 'custom', path: ['from'], message: 'must be before `to`' });
    } else if (to.getTime() - from.getTime() > AUDIT_LOG_MAX_RANGE_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: `range must not exceed ${AUDIT_LOG_MAX_RANGE_DAYS} days`,
      });
    }
  });

export type ListAuditLogDto = z.infer<typeof ListAuditLogSchema>;

/** 列表只回摘要；`changes` / `metadata` 是最肥的 jsonb，展開明細時才由 `GET /audit-logs/:id` 取。 */
const AuditLogSummaryShape = z.object({
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
});

export const AuditLogSummarySchema = defineSchema('AuditLogSummary', AuditLogSummaryShape);

export type AuditLogSummaryDto = z.infer<typeof AuditLogSummarySchema>;

export const AuditLogSchema = defineSchema(
  'AuditLog',
  AuditLogSummaryShape.extend({
    changes: z.record(z.string(), z.unknown()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  }),
);

export type AuditLogDto = z.infer<typeof AuditLogSchema>;
