import { Injectable } from '@nestjs/common';

import { AppException } from '@/core/errors';
import { paginated } from '@/core/http';
import type { AuditLogRow } from '@/db/schema';

import { resolveAuditLogRange } from './audit-log.constants';
import { AuditLogRepository } from './audit-log.repository';
import type { AuditLogSummaryRow } from './audit-log.repository';
import type { AuditLogDto, AuditLogSummaryDto, ListAuditLogDto } from './dto/list-audit-log.dto';

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

  async findOne(id: string): Promise<AuditLogDto> {
    let parsed: bigint;
    try {
      parsed = BigInt(id);
    } catch {
      throw new AppException('VALIDATION_FAILED', { fields: { id: 'must be a numeric id' } });
    }
    const row = await this.repo.findById(parsed);
    if (!row) throw new AppException('VALIDATION_FAILED', { fields: { id: 'not found' } });
    return toDto(row);
  }
}
