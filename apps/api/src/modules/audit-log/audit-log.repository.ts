import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, like, lte, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database } from '@/core/database';
import { prefixPattern, TENANT_DB } from '@/core/database';
import type { AuditLogRow } from '@/db/schema';
import { auditLogs, auditLogsArchive } from '@/db/schema';

import { AUDIT_LOG_COUNT_CAP } from './audit-log.constants';
import type { AuditLogRange } from './audit-log.constants';
import type { AuditLogCursor } from './audit-log.cursor';
import type { ListAuditLogDto } from './dto/list-audit-log.dto';

type AuditLogTable = typeof auditLogs | typeof auditLogsArchive;

export type AuditLogSummaryRow = Omit<AuditLogRow, 'changes' | 'metadata'>;

/** 列表的一列：另帶微秒精度的 `occurred_at`，給下一頁的游標用。 */
export type AuditLogListRow = AuditLogSummaryRow & { occurredAtExact: string };

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

function listColumns(table: AuditLogTable) {
  return {
    ...summaryColumns(table),
    occurredAtExact: sql<string>`to_char(${table.occurredAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
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
    cursor?: AuditLogCursor,
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
    // 游標：排在上一頁最後一筆之後（與排序 occurred_at DESC, id DESC 一致，兩表的 (occurred_at, id) 索引都用得上）
    if (cursor) {
      conditions.push(
        sql`(${table.occurredAt}, ${table.id}) < (${cursor.occurredAt}::timestamptz, ${cursor.id}::bigint)`,
      );
    }
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
   * 帶游標時以游標取代 offset（只讀 limit 筆）。多讀一筆判斷有沒有下一頁；總數不受游標影響，仍是整個條件的筆數。
   */
  async list(
    query: ListAuditLogDto,
    range: AuditLogRange,
    cursor?: AuditLogCursor,
  ): Promise<{ items: AuditLogListRow[]; hasMore: boolean; total: number }> {
    const offset = cursor ? 0 : query.offset;
    const hotWhere = this.buildFilters(auditLogs, query, range);
    const hotPage = this.buildFilters(auditLogs, query, range, cursor);
    const hot = this.db.select(listColumns(auditLogs)).from(auditLogs).where(hotPage);

    if (!(await this.archiveReaches(range.from))) {
      const [rows, total] = await Promise.all([
        hot
          .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
          .limit(query.limit + 1)
          .offset(offset),
        this.count(auditLogs, hotWhere),
      ]);
      return { items: rows.slice(0, query.limit), hasMore: rows.length > query.limit, total };
    }

    const coldWhere = this.buildFilters(auditLogsArchive, query, range);
    const cold = this.db
      .select(listColumns(auditLogsArchive))
      .from(auditLogsArchive)
      .where(this.buildFilters(auditLogsArchive, query, range, cursor));
    const [rows, hotTotal, coldTotal] = await Promise.all([
      hot
        .unionAll(cold)
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(query.limit + 1)
        .offset(offset),
      this.count(auditLogs, hotWhere),
      this.count(auditLogsArchive, coldWhere),
    ]);
    return {
      items: rows.slice(0, query.limit),
      hasMore: rows.length > query.limit,
      total: Math.min(hotTotal + coldTotal, AUDIT_LOG_COUNT_CAP),
    };
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
