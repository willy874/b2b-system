import { Inject, Injectable, Logger } from '@nestjs/common';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import { getRequestContext } from '@/core/http';
import { auditLogs } from '@/db/schema';

import type { AuditInput } from './audit.types';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /**
   * 業務變更的稽核 **必須** 傳入 `tx`，與變更同生共死。
   * 寫入失敗不吞例外——「無紀錄則無操作」。
   */
  async record(input: AuditInput, tx?: DbOrTx): Promise<void> {
    const ctx = getRequestContext();
    const db = tx ?? this.db;
    await db.insert(auditLogs).values({
      occurredAt: new Date(),
      actorId: input.actorId ?? ctx?.user?.id ?? null,
      actorEmail: input.actorEmail ?? ctx?.user?.email ?? 'system',
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      resourceName: input.resourceName ?? null,
      result: input.result ?? 'success',
      errorCode: input.errorCode ?? null,
      changes: input.changes ?? null,
      metadata: {
        ip: ctx?.ip,
        userAgent: ctx?.userAgent,
        requestId: ctx?.requestId,
        ...input.metadata,
      },
    });
  }

  /**
   * 交易外的稽核（登入失敗、授權拒絕）：業務操作本來就沒有成功，
   * 寫入失敗只記錯誤日誌，不讓它蓋掉原本要回給使用者的錯誤。
   */
  async recordSafely(input: AuditInput): Promise<void> {
    try {
      await this.record(input);
    } catch (error) {
      this.logger.error({ err: error, action: input.action }, '稽核寫入失敗');
    }
  }
}
