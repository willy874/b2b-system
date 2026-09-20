import { Injectable } from '@nestjs/common';

import { AppException } from '@/core/errors';
import { paginated } from '@/core/http';
import type { AuditLogRow } from '@/db/schema';

import { AuditLogRepository } from './audit-log.repository';
import type { AuditLogDto, ListAuditLogDto } from './dto/list-audit-log.dto';

function toDto(row: AuditLogRow): AuditLogDto {
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
    changes: (row.changes ?? null) as Record<string, unknown> | null,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
  };
}

@Injectable()
export class AuditLogService {
  constructor(private readonly repo: AuditLogRepository) {}

  async list(query: ListAuditLogDto) {
    const { items, total } = await this.repo.list(query);
    return paginated(items.map(toDto), total, query);
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
