import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import { platformAuditLogs } from '@/db/platform/schema';

export type PlatformAuditLogRow = typeof platformAuditLogs.$inferSelect;

export interface PlatformAuditLogFilter {
  offset: number;
  limit: number;
  /** 完整比對；以 `.*` 結尾時比對前綴。 */
  action?: string;
  actorEmail?: string;
  resourceId?: string;
  result?: 'success' | 'failure';
  from: Date;
  to: Date;
}

/** `%`、`_` 在 LIKE 裡是萬用字元：使用者輸入的要跳脫。 */
function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, (char) => `\\${char}`);
}

/** 平台稽核的查詢（平台 DB 的 `platform_audit_logs`，docs/architecture/05-tenancy.md §10.2 D19）。 */
@Injectable()
export class PlatformAuditLogRepository {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async list(
    filter: PlatformAuditLogFilter,
  ): Promise<{ items: PlatformAuditLogRow[]; total: number }> {
    const action = filter.action?.endsWith('.*')
      ? ilike(platformAuditLogs.action, `${escapeLike(filter.action.slice(0, -1))}%`)
      : filter.action
        ? eq(platformAuditLogs.action, filter.action)
        : undefined;
    const where = and(
      gte(platformAuditLogs.occurredAt, filter.from),
      lte(platformAuditLogs.occurredAt, filter.to),
      action,
      filter.actorEmail
        ? ilike(platformAuditLogs.actorEmail, `%${escapeLike(filter.actorEmail)}%`)
        : undefined,
      filter.resourceId ? eq(platformAuditLogs.resourceId, filter.resourceId) : undefined,
      filter.result ? eq(platformAuditLogs.result, filter.result) : undefined,
    );
    const [items, [count]] = await Promise.all([
      this.db
        .select()
        .from(platformAuditLogs)
        .where(where)
        .orderBy(desc(platformAuditLogs.occurredAt), desc(platformAuditLogs.id))
        .limit(filter.limit)
        .offset(filter.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(platformAuditLogs)
        .where(where),
    ]);
    return { items, total: count?.total ?? 0 };
  }
}
