import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, like, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database } from '@/core/database';
import { prefixPattern, TENANT_DB } from '@/core/database';
import type { AuditLogRow } from '@/db/schema';
import { auditLogs, auditLogsArchive } from '@/db/schema';

import { AUDIT_LOG_COUNT_CAP } from './audit-log.constants';
import type { AuditLogRange } from './audit-log.constants';
import type { ListAuditLogDto } from './dto/list-audit-log.dto';

type AuditLogTable = typeof auditLogs | typeof auditLogsArchive;

export type AuditLogSummaryRow = Omit<AuditLogRow, 'changes' | 'metadata'>;

/** 列表的投影：不讀 `changes` / `metadata`，省下 jsonb 的 detoast 與傳輸。 */
function summaryColumns(table: AuditLogTable) {
  return {
    id: table.id,
    occurredAt: table.occurredAt,
    actorId: table.actorId,
    actorEmail: table.actorEmail,
    action: table.action,
    resourceType: table.resourceType,
    resourceId: table.resourceId,
    resourceName: table.resourceName,
    result: table.result,
    errorCode: table.errorCode,
  };
}

function fullColumns(table: AuditLogTable) {
  return { ...summaryColumns(table), changes: table.changes, metadata: table.metadata };
}

@Injectable()
export class AuditLogRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  private buildFilters(
    table: AuditLogTable,
    query: ListAuditLogDto,
    range: AuditLogRange,
  ): SQL | undefined {
    // 時間範圍永遠存在：每個索引都以 occurred_at 結尾，範圍條件讓掃描有上下界
    const conditions: SQL[] = [gte(table.occurredAt, range.from), lte(table.occurredAt, range.to)];
    if (query.actorId) conditions.push(eq(table.actorId, query.actorId));
    if (query.action) {
      conditions.push(
        query.action.endsWith('*')
          ? like(table.action, prefixPattern(query.action.slice(0, -1)))
          : eq(table.action, query.action),
      );
    }
    if (query.resourceType) conditions.push(eq(table.resourceType, query.resourceType));
    if (query.resourceId) conditions.push(eq(table.resourceId, query.resourceId));
    if (query.result) conditions.push(eq(table.result, query.result));
    return and(...conditions);
  }

  /** 最多數到 `AUDIT_LOG_COUNT_CAP`：只掃過那麼多列就停。 */
  private count(table: AuditLogTable, where: SQL | undefined) {
    const capped = this.db
      .select({ one: sql`1`.as('one') })
      .from(table)
      .where(where)
      .limit(AUDIT_LOG_COUNT_CAP)
      .as('capped');
    return this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(capped)
      .then(([row]) => row?.total ?? 0);
  }

  /**
   * 範圍的起點晚於冷表最新的一筆時只查熱表；否則熱表與冷表 `UNION ALL`，
   * Postgres 會以兩邊的 `(occurred_at, id)` 索引做 Merge Append，只讀到 offset + limit 筆就停。
   */
  async list(
    query: ListAuditLogDto,
    range: AuditLogRange,
  ): Promise<{ items: AuditLogSummaryRow[]; total: number }> {
    const hotWhere = this.buildFilters(auditLogs, query, range);
    const hot = this.db.select(summaryColumns(auditLogs)).from(auditLogs).where(hotWhere);

    if (!(await this.archiveReaches(range.from))) {
      const [items, total] = await Promise.all([
        hot
          .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
          .limit(query.limit)
          .offset(query.offset),
        this.count(auditLogs, hotWhere),
      ]);
      return { items, total };
    }

    const coldWhere = this.buildFilters(auditLogsArchive, query, range);
    const cold = this.db
      .select(summaryColumns(auditLogsArchive))
      .from(auditLogsArchive)
      .where(coldWhere);
    const [items, hotTotal, coldTotal] = await Promise.all([
      hot
        .unionAll(cold)
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(query.limit)
        .offset(query.offset),
      this.count(auditLogs, hotWhere),
      this.count(auditLogsArchive, coldWhere),
    ]);
    return { items, total: Math.min(hotTotal + coldTotal, AUDIT_LOG_COUNT_CAP) };
  }

  /**
   * 冷表有沒有不早於 `from` 的紀錄。熱表保留天數是租戶的參數（docs/architecture/05-tenancy.md §13.3 D7），
   * 調大之後已搬走的紀錄不會回到熱表，所以看冷表實際的資料，不以天數推算。`max(occurred_at)` 只讀時間索引的第一列。
   */
  private async archiveReaches(from: Date): Promise<boolean> {
    const [row] = await this.db
      .select({ newest: sql<Date | null>`max(${auditLogsArchive.occurredAt})` })
      .from(auditLogsArchive);
    const newest = row?.newest;
    return newest ? new Date(newest).getTime() >= from.getTime() : false;
  }

  /** 先熱後冷，一次來回：`UNION ALL … LIMIT 1` 在熱表命中時不會去碰冷表。 */
  async findById(id: bigint): Promise<AuditLogRow | undefined> {
    const [row] = await this.db
      .select(fullColumns(auditLogs))
      .from(auditLogs)
      .where(eq(auditLogs.id, id))
      .unionAll(
        this.db
          .select(fullColumns(auditLogsArchive))
          .from(auditLogsArchive)
          .where(eq(auditLogsArchive.id, id)),
      )
      .limit(1);
    return row;
  }
}
