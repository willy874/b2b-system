import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSION } from '@/common/types';
import { DATA_TRANSFER_EXPORT_MAX_ROWS_PARAM, tenantFeatureParam } from '@/core/tenant';
import { AuditLogService } from '@/modules/audit-log/audit-log.service';
import type {
  AuditLogExportFilter,
  AuditLogExportRequest,
} from '@/modules/audit-log/audit-log.service';
import { AuditLogFilterSchema } from '@/modules/audit-log/dto/list-audit-log.dto';
import type { AuditLogDto } from '@/modules/audit-log/dto/list-audit-log.dto';

import { DataTransferRegistry } from '../data-transfer-registry.service';
import { DATA_TRANSFER_EXPORT_PAGE_SIZE } from '../data-transfer.constants';
import { defineTransferResource } from '../data-transfer.definition';
import type { ExportScope, TransferColumn } from '../data-transfer.types';

function toRequest(scope: ExportScope<AuditLogExportFilter>): AuditLogExportRequest {
  return scope.kind === 'ids' ? { ids: scope.ids } : { filter: scope.filter };
}

/**
 * 稽核日誌的匯出（docs/architecture/backend/22-data-transfer.md §2「第一批」；只匯出）。
 *
 * 登記在這裡而不在 `modules/audit-log`：稽核日誌是葉節點模組（全域 guard 要注入 `AuditService`），
 * 只能依賴其他葉節點（docs/coding-standards/07-layer-dependencies.md §4），不能 import 本模組。
 * 讀取一律經過 `AuditLogService` 公開的方法，沿用列表的 keyset，熱表與冷表一起讀。
 */
@Injectable()
export class AuditLogTransferResource implements OnModuleInit {
  constructor(
    private readonly registry: DataTransferRegistry,
    private readonly auditLogs: AuditLogService,
  ) {}

  onModuleInit(): void {
    const text = (key: keyof AuditLogDto, label: TransferColumn<AuditLogDto>['label']) =>
      ({
        key,
        label,
        kind: 'string',
        export: { get: (log) => log[key] },
      }) satisfies TransferColumn<AuditLogDto>;
    const columns: TransferColumn<AuditLogDto>[] = [
      text('id', { 'zh-TW': 'ID', 'en-US': 'ID' }),
      {
        key: 'occurredAt',
        label: { 'zh-TW': '時間', 'en-US': 'Time' },
        kind: 'datetime',
        export: { get: (log) => log.occurredAt },
      },
      text('actorEmail', { 'zh-TW': '操作者', 'en-US': 'Actor' }),
      text('actorId', { 'zh-TW': '操作者 ID', 'en-US': 'Actor ID' }),
      text('action', { 'zh-TW': '動作', 'en-US': 'Action' }),
      text('resourceType', { 'zh-TW': '資源類型', 'en-US': 'Resource type' }),
      text('resourceId', { 'zh-TW': '資源 ID', 'en-US': 'Resource ID' }),
      text('resourceName', { 'zh-TW': '資源名稱', 'en-US': 'Resource name' }),
      {
        key: 'result',
        label: { 'zh-TW': '結果', 'en-US': 'Result' },
        kind: 'enum',
        enum: [
          { value: 'success', label: { 'zh-TW': '成功', 'en-US': 'Success' } },
          { value: 'failure', label: { 'zh-TW': '失敗', 'en-US': 'Failure' } },
        ],
        export: { get: (log) => log.result },
      },
      text('errorCode', { 'zh-TW': '錯誤碼', 'en-US': 'Error code' }),
      {
        key: 'changes',
        label: { 'zh-TW': '變更', 'en-US': 'Changes' },
        kind: 'json',
        export: { get: (log) => log.changes },
      },
      {
        key: 'metadata',
        label: { 'zh-TW': '詳細資料', 'en-US': 'Metadata' },
        kind: 'json',
        export: { get: (log) => log.metadata },
      },
    ];

    this.registry.register(
      defineTransferResource<AuditLogExportFilter, AuditLogDto>({
        type: 'auditLog',
        feature: 'auditLog',
        fileBaseName: 'audit-logs',
        label: { 'zh-TW': '稽核日誌', 'en-US': 'Audit logs' },
        columns,
        exporter: {
          permissions: [PERMISSION.AUDIT_LOG_EXPORT],
          filterSchema: AuditLogFilterSchema,
          idSchema: z.string().regex(/^\d{1,19}$/),
          orderHint: { 'zh-TW': '依時間由新到舊排序', 'en-US': 'Newest first' },
          // 列表限制 90 天；匯出放寬到 366 天，超過回 VALIDATION_FAILED（filter.from）
          assertFilter: (filter) => {
            this.auditLogs.resolveExportRange(filter);
          },
          iterate: (scope) => this.iterate(scope),
          count: (scope) =>
            this.auditLogs.exportCount(
              toRequest(scope),
              tenantFeatureParam(DATA_TRANSFER_EXPORT_MAX_ROWS_PARAM) + 1,
            ),
        },
      }),
    );
  }

  private async *iterate(
    scope: ExportScope<AuditLogExportFilter>,
  ): AsyncIterable<readonly AuditLogDto[]> {
    let cursor: string | null = null;
    do {
      const page = await this.auditLogs.exportPage(
        toRequest(scope),
        cursor,
        DATA_TRANSFER_EXPORT_PAGE_SIZE,
      );
      if (page.items.length) yield page.items;
      cursor = page.nextCursor;
    } while (cursor);
  }
}
