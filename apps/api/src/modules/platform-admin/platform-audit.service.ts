import { Inject, Injectable, Logger } from '@nestjs/common';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import { getRequestContext, paginated } from '@/core/http';
import type { PaginatedResult } from '@/core/http';
import { platformAuditLogs } from '@/db/platform/schema';
import { resolveAuditLogRange } from '@/modules/audit-log/audit-log.constants';

import type { ListPlatformAuditLogDto, PlatformAuditLogDto } from './dto/platform-admin.dto';
import { PlatformAuditLogRepository } from './platform-audit-log.repository';

export interface PlatformAuditInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  actorId?: string | null;
  actorEmail?: string;
  result?: 'success' | 'failure';
  errorCode?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * 平台管理者的稽核（平台 DB 的 `platform_audit_logs`，docs/adr/0020-physical-tenant-isolation.md D19）。
 * 租戶內的動作寫在租戶的 `audit_logs`（`AuditService`），這裡不記。
 */
@Injectable()
export class PlatformAuditService {
  private readonly logger = new Logger(PlatformAuditService.name);

  constructor(
    @Inject(PLATFORM_DB) private readonly db: PlatformDatabase,
    private readonly logs: PlatformAuditLogRepository,
  ) {}

  /** 平台稽核頁（`platformAuditLog:read`）：固定 occurred_at DESC；時間範圍預設且最多 90 天（同租戶的稽核）。 */
  async list(query: ListPlatformAuditLogDto): Promise<PaginatedResult<PlatformAuditLogDto>> {
    const { from, to } = resolveAuditLogRange(query, new Date());
    const { items, total } = await this.logs.list({ ...query, from, to });
    return paginated(
      items.map((row) => ({
        id: row.id.toString(),
        occurredAt: row.occurredAt.toISOString(),
        actorId: row.actorId,
        actorEmail: row.actorEmail,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        result: row.result,
        errorCode: row.errorCode,
        metadata: row.metadata ?? null,
      })),
      total,
      query,
    );
  }

  async record(input: PlatformAuditInput): Promise<void> {
    const ctx = getRequestContext();
    await this.db.insert(platformAuditLogs).values({
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      actorId: input.actorId ?? ctx?.user?.id ?? null,
      actorEmail: input.actorEmail ?? ctx?.user?.email ?? 'anonymous',
      result: input.result ?? 'success',
      errorCode: input.errorCode ?? null,
      metadata: {
        ...input.metadata,
        ...(ctx && { ip: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId }),
      },
    });
  }

  /** 登入失敗等「不能因為稽核失敗而改變回應」的地方用。 */
  async recordSafely(input: PlatformAuditInput): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      this.logger.error({ err: error, action: input.action }, '平台稽核寫入失敗');
    }
  }
}
