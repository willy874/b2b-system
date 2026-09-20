import {
  bigserial,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const auditResult = pgEnum('audit_result', ['success', 'failure']);

export interface AuditChanges {
  before?: unknown;
  after?: unknown;
}

export interface AuditMetadata {
  ip?: string;
  userAgent?: string;
  requestId?: string;
  [key: string]: unknown;
}

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),

    // 操作者快照（刻意反正規化：使用者刪除後紀錄仍可讀，查詢不需 join）
    actorId: uuid('actor_id'),
    actorEmail: text('actor_email').notNull(), // 系統操作填 'system'

    action: text('action').notNull(), // 'role.update'
    resourceType: text('resource_type').notNull(), // 'role'
    resourceId: text('resource_id'),
    resourceName: text('resource_name'), // 快照

    result: auditResult('result').notNull(),
    errorCode: text('error_code'),

    changes: jsonb('changes').$type<AuditChanges>(), // { before: {...}, after: {...} }
    metadata: jsonb('metadata').$type<AuditMetadata>(), // { ip, userAgent, requestId, ... }
  },
  (t) => [
    index('audit_logs_occurred_idx').on(t.occurredAt.desc()),
    index('audit_logs_actor_idx').on(t.actorId, t.occurredAt.desc()),
    index('audit_logs_resource_idx').on(t.resourceType, t.resourceId, t.occurredAt.desc()),
    index('audit_logs_action_idx').on(t.action, t.occurredAt.desc()),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type AuditResult = (typeof auditResult.enumValues)[number];
