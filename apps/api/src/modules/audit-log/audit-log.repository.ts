import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, like, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { AuditLogRow } from '@/db/schema';
import { auditLogs } from '@/db/schema';

import type { ListAuditLogDto } from './dto/list-audit-log.dto';

@Injectable()
export class AuditLogRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private buildFilters(query: ListAuditLogDto): SQL | undefined {
    const conditions: SQL[] = [];
    if (query.actorId) conditions.push(eq(auditLogs.actorId, query.actorId));
    if (query.action) {
      conditions.push(
        query.action.endsWith('*')
          ? like(auditLogs.action, `${query.action.slice(0, -1)}%`)
          : eq(auditLogs.action, query.action),
      );
    }
    if (query.resourceType) conditions.push(eq(auditLogs.resourceType, query.resourceType));
    if (query.resourceId) conditions.push(eq(auditLogs.resourceId, query.resourceId));
    if (query.result) conditions.push(eq(auditLogs.result, query.result));
    if (query.from) conditions.push(gte(auditLogs.occurredAt, query.from));
    if (query.to) conditions.push(lte(auditLogs.occurredAt, query.to));
    return conditions.length ? and(...conditions) : undefined;
  }

  async list(query: ListAuditLogDto): Promise<{ items: AuditLogRow[]; total: number }> {
    const where = this.buildFilters(query);
    const [items, [counted]] = await Promise.all([
      this.db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(where),
    ]);
    return { items, total: counted?.total ?? 0 };
  }

  async findById(id: bigint): Promise<AuditLogRow | undefined> {
    const [row] = await this.db.select().from(auditLogs).where(eq(auditLogs.id, id)).limit(1);
    return row;
  }
}
