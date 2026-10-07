import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import {
  AUDIT_LOG_MAX_OFFSET,
  AUDIT_LOG_MAX_RANGE_DAYS,
  AUDIT_LOG_MAX_RANGE_MS,
} from '../audit-log.constants';

/** 列表與匯出共用的篩選欄位（匯出的範圍上限另計，docs/architecture/backend/22-data-transfer.md §6.2）。 */
export const AuditLogFilterSchema = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().trim().max(100).optional(), // 支援前綴比對：`role.*`
  resourceType: z.string().trim().max(50).optional(),
  resourceId: z.string().trim().max(100).optional(),
  result: z.enum(['success', 'failure']).optional(),
  // 沒帶時由 service 補成「現在往前 90 天」（resolveAuditLogRange）
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const ListAuditLogSchema = AuditLogFilterSchema.extend({
  offset: z.coerce.number().int().min(0).max(AUDIT_LOG_MAX_OFFSET).default(0),
  /**
   * keyset 分頁的游標（上一頁回應的 `nextCursor`）：帶了就從那一筆之後取，不再看 `offset`（兩者不能同時帶）。
   * 翻多深都只讀一頁，不受 `offset` 的上限限制。
   */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).superRefine(({ from, to, cursor, offset }, ctx) => {
  if (cursor !== undefined && offset > 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['cursor'],
      message: 'cannot be combined with `offset`',
    });
  }
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

/** 列表：除了一般的分頁資訊，另回下一頁的游標（沒有下一頁是 `null`）。 */
export const AuditLogListSchema = defineSchema(
  'AuditLogList',
  z.object({
    items: z.array(AuditLogSummarySchema),
    pagination: z.object({
      offset: z.number().int(),
      limit: z.number().int(),
      /** 最多數到 `AUDIT_LOG_COUNT_CAP`。 */
      total: z.number().int(),
    }),
    nextCursor: z.string().nullable(),
  }),
);

export type AuditLogListDto = z.infer<typeof AuditLogListSchema>;

export const AuditLogSchema = defineSchema(
  'AuditLog',
  AuditLogSummaryShape.extend({
    changes: z.record(z.string(), z.unknown()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
  }),
);

export type AuditLogDto = z.infer<typeof AuditLogSchema>;
