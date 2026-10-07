import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import { TENANT_DB, withTransaction } from '@/core/database';
import type { Database, Transaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { SettingService } from '@/core/settings';
import type { DataTransferRow } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { notification } from '@/modules/notification/notification.definition';
import { NotificationService } from '@/modules/notification/notification.service';

import { DATA_TRANSFER_SUMMARY_RETENTION_DAYS } from './data-transfer.constants';
import {
  DATA_TRANSFER_EXPORT_FINISHED_NOTIFICATION,
  DATA_TRANSFER_IMPORT_FINISHED_NOTIFICATION,
  dataTransferDetailLink,
} from './data-transfer.notifications';
import { DataTransferRepository } from './data-transfer.repository';
import { DATA_TRANSFER_RETENTION_DAYS_SETTING } from './data-transfer.settings';
import type { DataTransferDto } from './dto/data-transfer.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 稽核的資源類型（加進稽核日誌頁的資源篩選，§9.2）。 */
export const DATA_TRANSFER_RESOURCE_TYPE = 'dataTransfer';

/** 傳輸列 → API 回應。 */
export function toTransferDto(row: DataTransferRow): DataTransferDto {
  const params = row.params as { scope?: { kind?: string }; columns?: unknown };
  const scopeKind =
    params.scope?.kind === 'ids' || params.scope?.kind === 'filter' ? params.scope.kind : null;
  return {
    id: row.id,
    direction: row.direction as DataTransferDto['direction'],
    type: row.type,
    mode: (row.mode as DataTransferDto['mode']) ?? null,
    format: row.format as DataTransferDto['format'],
    status: row.status as DataTransferDto['status'],
    scopeKind,
    columns: Array.isArray(params.columns) ? params.columns.map(String) : [],
    sourceName: row.sourceName,
    outputName: row.outputName,
    outputSize: row.outputSize,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    succeededRows: row.succeededRows,
    failedRows: row.failedRows,
    skippedRows: row.skippedRows,
    errorCode: row.errorCode,
    errorDetails: row.errorDetails,
    version: row.version,
    expiresAt: row.expiresAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * 傳輸的共用動作：保留期限、失敗、完成通知、推播（docs/architecture/backend/22-data-transfer.md §6.3、§7.6、§9.3、§9.4）。
 * 推播只給建立者（`perRecipient`），進度的節流由呼叫端負責（每個傳輸最多每秒一次）。
 */
@Injectable()
export class DataTransferLifecycle {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: DataTransferRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly events: DomainEventBus,
    private readonly settings: SettingService,
  ) {}

  /** 匯出檔與套用列的到期時間：從完成時起算 `dataTransfer.retentionDays`（D12）。 */
  async expiresAt(from = new Date()): Promise<Date> {
    const days = await this.settings.get(DATA_TRANSFER_RETENTION_DAYS_SETTING);
    return new Date(from.getTime() + days * DAY_MS);
  }

  /** 還沒結束的傳輸的到期時間：只是佔位，完成時重算；摘要最多保留 90 天。 */
  pendingExpiresAt(from = new Date()): Date {
    return new Date(from.getTime() + DATA_TRANSFER_SUMMARY_RETENTION_DAYS * DAY_MS);
  }

  publish(transfer: Pick<DataTransferRow, 'id' | 'createdBy'>, kind: ChangeKind): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [],
      perRecipient: [
        {
          userId: transfer.createdBy,
          changes: [{ resource: ChangeSource.DATA_TRANSFER, kind, id: transfer.id }],
        },
      ],
    });
  }

  /** 完成通知（匯出與匯入各一種），在完成的交易內寫入。 */
  async notifyFinished(transfer: DataTransferRow, tx: Transaction): Promise<void> {
    const link = dataTransferDetailLink(transfer.id);
    if (transfer.direction === 'export') {
      await this.notifications.notify(
        notification(DATA_TRANSFER_EXPORT_FINISHED_NOTIFICATION, {
          recipientId: transfer.createdBy,
          // 系統通知：`notify()` 對「actor 就是收件人」不建立通知，而收件人一定是建立者本人（§9.3）
          actorId: null,
          params: {
            status: transfer.status,
            type: transfer.type,
            format: transfer.format,
            rows: transfer.totalRows,
            errorCode: transfer.errorCode,
          },
          link,
          sourceId: transfer.id,
        }),
        tx,
      );
      return;
    }
    await this.notifications.notify(
      notification(DATA_TRANSFER_IMPORT_FINISHED_NOTIFICATION, {
        recipientId: transfer.createdBy,
        actorId: null,
        params: {
          status: transfer.status,
          type: transfer.type,
          mode: transfer.mode ?? 'create',
          succeeded: transfer.succeededRows,
          failed: transfer.failedRows,
          skipped: transfer.skippedRows,
          errorCode: transfer.errorCode,
        },
        link,
        sourceId: transfer.id,
      }),
      tx,
    );
  }

  /**
   * 整個傳輸無法進行（權限被拿掉、建立者停用、超過上限、重試用盡）：`failed` ＋ 錯誤碼，通知建立者。
   * 已經被取消或結束的不覆寫。
   */
  async fail(
    transferId: string,
    errorCode: string,
    errorDetails: Record<string, unknown> | null = null,
  ): Promise<DataTransferRow | undefined> {
    const now = new Date();
    const expiresAt = await this.expiresAt(now);
    const failed = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.transition(
        transferId,
        ['queued', 'running', 'applying'],
        { status: 'failed', errorCode, errorDetails, finishedAt: now, expiresAt },
        { tx },
      );
      if (row) await this.notifyFinished(row, tx);
      return row;
    });
    if (failed) this.publish(failed, ChangeKind.UPDATE);
    return failed;
  }

  /** 稽核：傳輸本身的動作（建立者的身分由 request context 或工作的 `runAs` 帶入）。 */
  async record(
    action: string,
    transfer: DataTransferRow,
    metadata: Record<string, unknown>,
    tx?: Transaction,
  ): Promise<void> {
    await this.audit.record(
      {
        action,
        resourceType: DATA_TRANSFER_RESOURCE_TYPE,
        resourceId: transfer.id,
        resourceName: transfer.outputName ?? transfer.sourceName ?? transfer.type,
        metadata,
      },
      tx,
    );
  }
}
