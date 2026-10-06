import { Injectable } from '@nestjs/common';

import { AppException } from '@/core/errors';
import { paginated } from '@/core/http';
import type { AuditLogRow } from '@/db/schema';

import { resolveAuditLogRange } from './audit-log.constants';
import { AuditLogRepository } from './audit-log.repository';
import type { AuditLogSummaryRow } from './audit-log.repository';
import type { AuditLogDto, AuditLogSummaryDto, ListAuditLogDto } from './dto/list-audit-log.dto';

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

@Injectable()
export class AuditLogService {
  constructor(private readonly repo: AuditLogRepository) {}

  async list(query: ListAuditLogDto) {
    const range = resolveAuditLogRange(query, new Date());
    const { items, total } = await this.repo.list(query, range);
    return paginated(items.map(toSummaryDto), total, query);
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
