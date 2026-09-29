import { Inject, Injectable, Logger } from '@nestjs/common';

import { PLATFORM_DB } from '@/core/database';
import type { PlatformDatabase } from '@/core/database';
import { getRequestContext } from '@/core/http';
import { platformAuditLogs } from '@/db/platform/schema';

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

  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

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
