import { ChangeKind } from '@b2b-system/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { TENANT_DB, withTransaction } from '@/core/database';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { JobContext } from '@/core/jobs';
import { dataTransferBytes, dataTransferRows } from '@/core/metrics';
import { ObjectStorage } from '@/core/storage';
import { DATA_TRANSFER_EXPORT_MAX_ROWS_PARAM, tenantFeatureParam } from '@/core/tenant';
import type { DataTransferRow } from '@/db/schema';

import { DataTransferRegistry } from '../data-transfer-registry.service';
import {
  DATA_TRANSFER_EXPORT_PART_BYTES,
  DATA_TRANSFER_PROGRESS_INTERVAL_MS,
  DATA_TRANSFER_PROGRESS_ROWS,
} from '../data-transfer.constants';
import {
  DataTransferContextFactory,
  TransferOwnerUnavailableError,
} from '../data-transfer.context';
import { DATA_TRANSFER_EXPORT_JOB } from '../data-transfer.job-types';
import { DataTransferLifecycle } from '../data-transfer.lifecycle';
import { DataTransferRepository } from '../data-transfer.repository';
import type {
  AnyTransferResource,
  ExportFormat,
  ExportScope,
  TransferContext,
} from '../data-transfer.types';
import { fileTimestamp } from '../data-transfer.values';
import { createExportWriter, EXPORT_CONTENT_TYPE } from './export-writers';
import { MultipartSink } from './multipart-sink';

interface ExportParams {
  scope: ExportScope<unknown>;
  columns: string[];
}

/** 使用者在工作執行中取消：停止並放棄已上傳的段。 */
class ExportCancelled extends Error {}

/** 檔名：`<fileBaseName>-<YYYYMMDD-HHmm>[-selection].<ext>`，時間取匯出者時區（§6.5）。 */
export function exportFileName(
  resource: Pick<AnyTransferResource, 'fileBaseName'>,
  format: ExportFormat,
  createdAt: Date,
  timezone: string,
  selection: boolean,
): string {
  return `${resource.fileBaseName}-${fileTimestamp(createdAt, timezone)}${selection ? '-selection' : ''}.${format}`;
}

/**
 * `dataTransfer.export`（docs/architecture/backend/22-data-transfer.md §6.3）：以建立者當下的權限逐頁查詢，
 * 依格式寫檔、每 8 MiB 以伺服器端的 multipart 上傳一段，完成時在一個交易內記下產出、寫稽核、通知建立者。
 */
@Injectable()
export class DataTransferExportService {
  private readonly logger = new Logger(DataTransferExportService.name);

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: DataTransferRepository,
    private readonly registry: DataTransferRegistry,
    private readonly contexts: DataTransferContextFactory,
    private readonly lifecycle: DataTransferLifecycle,
    private readonly storage: ObjectStorage,
  ) {}

  async run(transferId: string, job: JobContext): Promise<object> {
    const queued = await this.repo.findById(transferId);
    if (!queued) return { skipped: 'notFound' };
    // 重試時已經是 running：從頭產生、覆寫同一個物件 key
    const transfer = await this.repo.transition(transferId, ['queued', 'running'], {
      status: 'running',
      startedAt: queued.startedAt ?? new Date(),
      processedRows: 0,
    });
    if (!transfer) return { skipped: queued.status };
    this.lifecycle.publish(transfer, ChangeKind.UPDATE);

    const resource = this.registry.find(transfer.type);
    if (!resource?.exporter) {
      await this.lifecycle.fail(transferId, 'DATA_TRANSFER_TYPE_UNSUPPORTED', {
        type: transfer.type,
      });
      return { failed: 'DATA_TRANSFER_TYPE_UNSUPPORTED' };
    }
    let ctx: TransferContext;
    try {
      ctx = await this.contexts.forJob(transfer, job.signal);
    } catch (error) {
      if (!(error instanceof TransferOwnerUnavailableError)) throw error;
      await this.lifecycle.fail(transferId, 'AUTHZ_FORBIDDEN', { reason: 'ownerUnavailable' });
      return { failed: 'AUTHZ_FORBIDDEN' };
    }
    return this.contexts.runAs(ctx, job.id, () => this.export(transfer, resource, ctx, job));
  }

  private async export(
    transfer: DataTransferRow,
    resource: AnyTransferResource,
    ctx: TransferContext,
    job: JobContext,
  ): Promise<object> {
    const exporter = resource.exporter;
    if (!exporter) throw new Error('exporter 已在 run() 檢查');
    // 建立後被拿掉權限 → failed（§6.3 步驟 2）
    try {
      await this.contexts.assertHasAll(ctx.actor, exporter.permissions, 'job dataTransfer.export');
    } catch (error) {
      if (!(error instanceof AppException)) throw error;
      await this.lifecycle.fail(transfer.id, error.code, error.details ?? null);
      return { failed: error.code };
    }
    const params = transfer.params as unknown as ExportParams;
    const max = tenantFeatureParam(DATA_TRANSFER_EXPORT_MAX_ROWS_PARAM);
    const estimated = await exporter.count(params.scope, ctx);
    if (estimated > max) {
      await this.lifecycle.fail(transfer.id, 'DATA_TRANSFER_TOO_MANY_ROWS', {
        max,
        count: estimated,
      });
      return { failed: 'DATA_TRANSFER_TOO_MANY_ROWS' };
    }

    // 欄位在建立時已檢查過權限；這裡以建立者當下的權限再過濾一次
    const columns = resource.columns.filter(
      (column) =>
        column.export &&
        params.columns.includes(column.key) &&
        (!column.permission || ctx.can(column.permission)),
    );
    const format = transfer.format as ExportFormat;
    const fileName = exportFileName(
      resource,
      format,
      transfer.createdAt,
      ctx.timezone,
      params.scope.kind === 'ids',
    );
    const key = `transfers/${transfer.id}/${fileName}`;
    const sink = new MultipartSink(
      this.storage,
      key,
      EXPORT_CONTENT_TYPE[format],
      DATA_TRANSFER_EXPORT_PART_BYTES,
    );
    const writer = createExportWriter(format, columns, ctx, sink, {
      fileBaseName: resource.fileBaseName,
      label: resource.label[ctx.locale],
      generatedAt: new Date(),
      generatedBy: ctx.actor.email,
    });

    let rows = 0;
    let reportedRows = 0;
    let reportedAt = Date.now();
    let size: number;
    let truncatedCells: number;
    try {
      await writer.start();
      for await (const page of exporter.iterate(params.scope, ctx)) {
        if (job.signal.aborted) throw new Error('匯出工作被中止（關機或逾時），交給重試');
        rows += page.length;
        if (rows > max) {
          await sink.abort();
          await this.lifecycle.fail(transfer.id, 'DATA_TRANSFER_TOO_MANY_ROWS', {
            max,
            count: rows,
          });
          return { failed: 'DATA_TRANSFER_TOO_MANY_ROWS' };
        }
        await writer.write(page);
        await sink.flush();
        // 每 500 列或每秒（取較慢者）更新進度、推播並檢查取消（§6.3 步驟 5）
        if (
          rows - reportedRows >= DATA_TRANSFER_PROGRESS_ROWS &&
          Date.now() - reportedAt >= DATA_TRANSFER_PROGRESS_INTERVAL_MS
        ) {
          reportedRows = rows;
          reportedAt = Date.now();
          const current = await this.repo.updateProgress(transfer.id, 'running', {
            processedRows: rows,
          });
          if (current?.status !== 'running') throw new ExportCancelled();
          this.lifecycle.publish(current, ChangeKind.UPDATE);
        }
      }
      ({ truncatedCells } = await writer.finish(rows));
      size = await sink.complete();
    } catch (error) {
      await sink
        .abort()
        .catch((abortError: unknown) =>
          this.logger.warn(
            { err: abortError, transferId: transfer.id },
            '放棄匯出檔的分段上傳失敗',
          ),
        );
      if (error instanceof ExportCancelled) return { cancelled: true, rows };
      if (job.retryCount >= DATA_TRANSFER_EXPORT_JOB.options.retryLimit) {
        await this.lifecycle.fail(
          transfer.id,
          error instanceof AppException ? error.code : 'INTERNAL_ERROR',
        );
      }
      throw error;
    }

    const finishedAt = new Date();
    const expiresAt = await this.lifecycle.expiresAt(finishedAt);
    const completed = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.transition(
        transfer.id,
        ['running'],
        {
          status: 'completed',
          outputKey: key,
          outputName: fileName,
          outputSize: size,
          totalRows: rows,
          processedRows: rows,
          finishedAt,
          expiresAt,
          errorDetails: truncatedCells ? { truncatedCells } : null,
        },
        { tx },
      );
      if (!row) return undefined;
      await this.lifecycle.record(
        'dataTransfer.export',
        row,
        {
          type: row.type,
          format: row.format,
          scope: params.scope.kind,
          ...(params.scope.kind === 'filter'
            ? { filter: params.scope.filter }
            : { selected: params.scope.ids.length }),
          rows,
          columns: columns.map((column) => column.key),
        },
        tx,
      );
      await this.lifecycle.notifyFinished(row, tx);
      return row;
    });
    if (!completed) {
      // 寫檔期間被取消：產出不保留
      await this.storage.delete(key);
      return { cancelled: true, rows };
    }
    dataTransferRows.inc({ direction: 'export', type: transfer.type, result: 'succeeded' }, rows);
    dataTransferBytes.inc({ direction: 'export', format }, size);
    this.lifecycle.publish(completed, ChangeKind.UPDATE);
    return { rows, bytes: size };
  }
}
