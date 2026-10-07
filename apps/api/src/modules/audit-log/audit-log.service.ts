import { Injectable } from '@nestjs/common';

import { AppException } from '@/core/errors';
import type { AuditLogRow } from '@/db/schema';

import {
  AUDIT_LOG_EXPORT_MAX_RANGE_DAYS,
  AUDIT_LOG_EXPORT_MAX_RANGE_MS,
  resolveAuditLogRange,
} from './audit-log.constants';
import { decodeAuditLogCursor, encodeAuditLogCursor } from './audit-log.cursor';
import { AuditLogRepository } from './audit-log.repository';
import type { AuditLogExportScope, AuditLogSummaryRow } from './audit-log.repository';
import type {
  AuditLogDto,
  AuditLogListDto,
  AuditLogSummaryDto,
  ListAuditLogDto,
} from './dto/list-audit-log.dto';

/** `audit_logs.id` 是 Postgres 的 bigint（有號 64 位元）。 */
const MAX_BIGINT = 9_223_372_036_854_775_807n;

function toSummaryDto(row: AuditLogSummaryRow): AuditLogSummaryDto {
  return {
    id: row.id.toString(),
    occurredAt: row.occurredAt.toISOString(),
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    result: row.result,
    errorCode: row.errorCode,
  };
}

function toDto(row: AuditLogRow): AuditLogDto {
  return {
    ...toSummaryDto(row),
    changes: (row.changes ?? null) as Record<string, unknown> | null,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
  };
}

/** 匯出的篩選條件：列表的 query 去掉分頁（docs/architecture/backend/22-data-transfer.md §6.1）。 */
export type AuditLogExportFilter = Omit<ListAuditLogDto, 'offset' | 'limit' | 'cursor'>;

/** 匯出的範圍（給 `modules/data-transfer` 的 exporter）。 */
export type AuditLogExportRequest = { filter: AuditLogExportFilter } | { ids: readonly string[] };

export interface AuditLogExportPage {
  items: AuditLogDto[];
  /** 下一頁的游標；最後一頁是 null。 */
  nextCursor: string | null;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly repo: AuditLogRepository) {}

  async list(query: ListAuditLogDto): Promise<AuditLogListDto> {
    const cursor = query.cursor === undefined ? undefined : decodeAuditLogCursor(query.cursor);
    if (query.cursor !== undefined && !cursor) {
      throw new AppException('VALIDATION_FAILED', { fields: { cursor: 'invalid cursor' } });
    }
    const range = resolveAuditLogRange(query, new Date());
    const { items, hasMore, total } = await this.repo.list(query, range, cursor);
    const last = items.at(-1);
    return {
      items: items.map(toSummaryDto),
      pagination: { offset: cursor ? 0 : query.offset, limit: query.limit, total },
      nextCursor:
        hasMore && last
          ? encodeAuditLogCursor({ occurredAt: last.occurredAtExact, id: last.id.toString() })
          : null,
    };
  }

  /**
   * 匯出的時間範圍：與列表相同的預設（沒帶時是最近 90 天），但上限放寬到 366 天；超過回 `VALIDATION_FAILED`（`filter.from`）。
   */
  resolveExportRange(filter: AuditLogExportFilter, now = new Date()) {
    const range = resolveAuditLogRange(filter, now);
    if (range.from > range.to) {
      throw new AppException('VALIDATION_FAILED', {
        fields: { 'filter.from': 'must be before `to`' },
      });
    }
    if (range.to.getTime() - range.from.getTime() > AUDIT_LOG_EXPORT_MAX_RANGE_MS) {
      throw new AppException('VALIDATION_FAILED', {
        fields: { 'filter.from': `range must not exceed ${AUDIT_LOG_EXPORT_MAX_RANGE_DAYS} days` },
      });
    }
    return range;
  }

  /** 匯出的一頁（完整欄位，含 changes、metadata），沿用列表的 keyset。 */
  async exportPage(
    request: AuditLogExportRequest,
    cursor: string | null,
    limit: number,
  ): Promise<AuditLogExportPage> {
    const decoded = cursor ? decodeAuditLogCursor(cursor) : undefined;
    const rows = await this.repo.exportPage(this.exportScope(request), decoded, limit);
    const last = rows.at(-1);
    return {
      items: rows.map(toDto),
      nextCursor:
        rows.length === limit && last
          ? encodeAuditLogCursor({ occurredAt: last.occurredAtExact, id: last.id.toString() })
          : null,
    };
  }

  async exportCount(request: AuditLogExportRequest, cap: number): Promise<number> {
    return this.repo.exportCount(this.exportScope(request), cap);
  }

  private exportScope(request: AuditLogExportRequest): AuditLogExportScope {
    if ('ids' in request) {
      return {
        ids: request.ids.filter((id) => /^\d+$/.test(id) && BigInt(id) <= MAX_BIGINT).map(BigInt),
      };
    }
    return { filter: request.filter, range: this.resolveExportRange(request.filter) };
  }

  /**
   * id 不是正整數（含空字串、`BigInt()` 接受的 `0x…`／空白）是格式錯誤，同其他資源的 `ParseUUIDPipe`；
   * 超出 bigint 範圍的數字不可能存在，直接當成查無，不送進資料庫（docs/architecture/backend/06-audit-log.md §7）。
   */
  async findOne(id: string): Promise<AuditLogDto> {
    if (!/^\d+$/.test(id)) {
      throw new AppException('VALIDATION_FAILED', { fields: { id: 'must be a numeric id' } });
    }
    const parsed = BigInt(id);
    const row = parsed <= MAX_BIGINT ? await this.repo.findById(parsed) : undefined;
    if (!row) throw new AppException('AUDIT_LOG_NOT_FOUND');
    return toDto(row);
  }
}
