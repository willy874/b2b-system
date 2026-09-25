import {
  bigint,
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

/**
 * 熱表與冷表共用的欄位（主鍵以外）。兩張表的欄位順序必須一致：
 * `archive_audit_logs()` 與冷熱 `UNION ALL` 都依賴它（docs/architecture/backend/06-audit-log.md §8）。
 */
const auditLogColumns = () => ({
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
});

/** 熱資料：最近 `AUDIT_LOG_HOT_RETENTION_DAYS` 天，所有寫入都進這裡，索引齊全。 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    ...auditLogColumns(),
  },
  (t) => [
    index('audit_logs_occurred_idx').on(t.occurredAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index('audit_logs_actor_idx').on(t.actorId, t.occurredAt.desc().nullsFirst()),
    index('audit_logs_resource_idx').on(
      t.resourceType,
      t.resourceId,
      t.occurredAt.desc().nullsFirst(),
    ),
    // text_pattern_ops 讓 `action LIKE 'role.%'` 的前綴比對也能走索引（預設 collation 不行）
    index('audit_logs_action_idx').on(
      t.action.op('text_pattern_ops'),
      t.occurredAt.desc().nullsFirst(),
    ),
  ],
);

/**
 * 冷資料：由 `archive_audit_logs()` 從熱表搬過來，`id` 沿用熱表的值。
 * 只留「依時間」與「查某人／某資源的歷史」兩種查詢的索引；`action` 前綴查詢在
 * 90 天範圍內靠時間索引過濾即可，不值得為冷資料多養一份索引。
 */
export const auditLogsArchive = pgTable(
  'audit_logs_archive',
  {
    id: bigint('id', { mode: 'bigint' }).primaryKey(),
    ...auditLogColumns(),
  },
  (t) => [
    index('audit_logs_archive_occurred_idx').on(
      t.occurredAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    index('audit_logs_archive_actor_idx').on(t.actorId, t.occurredAt.desc().nullsFirst()),
    index('audit_logs_archive_resource_idx').on(
      t.resourceType,
      t.resourceId,
      t.occurredAt.desc().nullsFirst(),
    ),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type AuditResult = (typeof auditResult.enumValues)[number];
