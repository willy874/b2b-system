import { ChangeKind } from '@b2b-system/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import { TENANT_DB, withTransaction } from '@/core/database';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { paginated } from '@/core/http';
import { JobQueue } from '@/core/jobs';
import { ObjectStorage } from '@/core/storage';
import { DATA_TRANSFER_EXPORT_MAX_ROWS_PARAM, tenantFeatureParam } from '@/core/tenant';
import type { DataTransferRow } from '@/db/schema';

import { DataTransferRegistry } from './data-transfer-registry.service';
import { exportableColumns } from './data-transfer.columns';
import { DATA_TRANSFER_MAX_ACTIVE_PER_USER } from './data-transfer.constants';
import { DataTransferContextFactory, forbidden } from './data-transfer.context';
import type { ClientPreference } from './data-transfer.context';
import { DATA_TRANSFER_EXPORT_JOB } from './data-transfer.job-types';
import { DataTransferLifecycle, toTransferDto } from './data-transfer.lifecycle';
import { DataTransferRepository } from './data-transfer.repository';
import { EXPORT_FORMATS } from './data-transfer.types';
import type { ExportScope, TransferStatus } from './data-transfer.types';
import type {
  CancelDataTransferDto,
  CreateExportDto,
  DataTransferDto,
  ListDataTransferDto,
  ListTransferRowsDto,
} from './dto/data-transfer.dto';

/** 可以取消的狀態（§6.4）。 */
const CANCELLABLE: Readonly<Record<string, readonly TransferStatus[]>> = {
  export: ['queued', 'running'],
  import: ['queued', 'applying'],
};
const ENDED: ReadonlySet<string> = new Set<TransferStatus>([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

/**
 * 傳輸的 API（docs/architecture/backend/22-data-transfer.md §4.2）：只能操作自己建立的，別人的一律 404（與通知相同，不洩漏存在與否）；
 * 依資源而定的權限在這裡以 `assertHasAll` 檢查（會寫 `authz.denied` 稽核，與路由的 `@RequirePermissions` 效果相同）。
 */
@Injectable()
export class DataTransferService {
  private readonly logger = new Logger(DataTransferService.name);
  private readonly urlTtl: number;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: DataTransferRepository,
    private readonly registry: DataTransferRegistry,
    private readonly contexts: DataTransferContextFactory,
    private readonly lifecycle: DataTransferLifecycle,
    private readonly jobs: JobQueue,
    private readonly storage: ObjectStorage,
    config: ConfigService<Env, true>,
  ) {
    this.urlTtl = config.get('FILE_URL_TTL', { infer: true });
  }

  async list(query: ListDataTransferDto, actor: AuthUser) {
    const { items, total } = await this.repo.listByCreator(actor.id, query);
    return paginated(items.map(toTransferDto), total, query);
  }

  async findOne(id: string, actor: AuthUser): Promise<DataTransferDto> {
    return toTransferDto(await this.getOwned(id, actor));
  }

  async cancel(id: string, dto: CancelDataTransferDto, actor: AuthUser): Promise<DataTransferDto> {
    const transfer = await this.getOwned(id, actor);
    const from = CANCELLABLE[transfer.direction] ?? [];
    if (!from.includes(transfer.status as TransferStatus)) {
      throw new AppException('DATA_TRANSFER_INVALID_STATE', { status: transfer.status });
    }
    const cancelled = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.transition(
        id,
        from,
        {
          status: 'cancelled',
          finishedAt: new Date(),
          expiresAt: await this.lifecycle.expiresAt(),
        },
        { expectedVersion: dto.version, tx },
      );
      if (!row) {
        const current = await this.repo.findById(id, tx);
        if (current && current.version !== dto.version) {
          throw new AppException('DATA_TRANSFER_VERSION_CONFLICT', { current: current.version });
        }
        throw new AppException('DATA_TRANSFER_INVALID_STATE', { status: current?.status ?? null });
      }
      await this.lifecycle.record(
        'dataTransfer.cancel',
        row,
        { direction: row.direction, type: row.type, status: transfer.status },
        tx,
      );
      return row;
    });
    // 還沒開始的匯入：套用列直接標成取消；執行中的由工作在下一個檢查點處理（§6.4）
    if (transfer.status === 'queued' && transfer.direction === 'import') {
      await this.repo.settlePending(id, 'cancelled', null);
    }
    this.lifecycle.publish(cancelled, ChangeKind.UPDATE);
    return toTransferDto(cancelled);
  }

  /** 刪除已結束的傳輸：立即刪除檔案與套用列，不影響任何業務資料。 */
  async remove(id: string, actor: AuthUser): Promise<void> {
    const transfer = await this.getOwned(id, actor);
    if (!ENDED.has(transfer.status)) {
      throw new AppException('DATA_TRANSFER_INVALID_STATE', { status: transfer.status });
    }
    if (transfer.outputKey) await this.storage.delete(transfer.outputKey);
    await this.repo.delete(id);
    this.lifecycle.publish(transfer, ChangeKind.DELETE);
  }

  /**
   * 下載連結（§6.4、D12）：每次重新簽發，連結最多 `FILE_URL_TTL`；下載當下仍要有該資源的匯出權限——
   * 被拿掉權限的人不能下載先前產生的檔案。
   */
  async download(id: string, actor: AuthUser) {
    const transfer = await this.getOwned(id, actor);
    if (transfer.direction !== 'export') {
      throw new AppException('DATA_TRANSFER_INVALID_STATE', { status: transfer.status });
    }
    if (transfer.status === 'expired') throw new AppException('DATA_TRANSFER_EXPIRED');
    if (transfer.status !== 'completed' || !transfer.outputKey || !transfer.outputName) {
      throw new AppException('DATA_TRANSFER_INVALID_STATE', { status: transfer.status });
    }
    const resource = this.registry.require(transfer.type, 'export');
    await this.contexts.assertHasAll(
      actor,
      resource.exporter?.permissions ?? [],
      'POST /data-transfers/:id/download',
    );
    const signed = await this.storage.presignDownload(transfer.outputKey, {
      disposition: 'attachment',
      fileName: transfer.outputName,
      expiresIn: this.urlTtl,
    });
    await this.lifecycle.record('dataTransfer.download', transfer, {
      type: transfer.type,
      format: transfer.format,
      rows: transfer.totalRows,
    });
    return {
      url: signed.url,
      expiresAt: signed.expiresAt.toISOString(),
      fileName: transfer.outputName,
    };
  }

  /** 操作者可以匯出或匯入的資源類型，以及各自可用的欄位與格式。 */
  async resources(actor: AuthUser, preference: ClientPreference) {
    const ctx = await this.contexts.forRequest(actor, preference);
    const items = this.registry.list().flatMap((resource) => {
      const exporter = resource.exporter;
      const canExport = exporter?.permissions.every((key) => ctx.can(key)) ?? false;
      const importModes = (['create', 'update'] as const).filter((mode) =>
        resource.importer?.modes[mode]?.permissions.every((key) => ctx.can(key)),
      );
      if (!canExport && importModes.length === 0) return [];
      return [
        {
          type: resource.type,
          label: resource.label[ctx.locale],
          export: canExport
            ? {
                formats: [...EXPORT_FORMATS],
                columns: exportableColumns(resource, ctx).map((column) => ({
                  key: column.key,
                  label: column.label[ctx.locale],
                  kind: column.kind,
                })),
                orderHint: exporter?.orderHint?.[ctx.locale] ?? null,
              }
            : null,
          importModes,
        },
      ];
    });
    return { items };
  }

  /**
   * 建立匯出（§6.1）：以操作者當下的權限檢查，篩選條件以資源的 `filterSchema` 驗證；
   * 超過上限在這裡就回 422，不入列。工作在同一個交易入列（`job_outbox`）。
   */
  async createExport(
    dto: CreateExportDto,
    actor: AuthUser,
    preference: ClientPreference,
  ): Promise<DataTransferDto> {
    const resource = this.registry.require(dto.type, 'export');
    const exporter = resource.exporter;
    if (!exporter) throw new AppException('DATA_TRANSFER_TYPE_UNSUPPORTED', { type: dto.type });
    const ctx = await this.contexts.forRequest(actor, preference);
    await this.contexts.assertHasAll(actor, exporter.permissions, 'POST /data-transfers/exports');

    const readable = exportableColumns(resource, ctx);
    let columns = readable;
    if (dto.columns) {
      const unknown = dto.columns.filter(
        (key) => !resource.columns.some((column) => column.key === key && column.export),
      );
      if (unknown.length) {
        throw new AppException('VALIDATION_FAILED', { fields: { columns: unknown.join(',') } });
      }
      const denied = resource.columns.filter(
        (column) => dto.columns?.includes(column.key) && !readable.includes(column),
      );
      if (denied.length)
        throw forbidden(denied.flatMap((column) => (column.permission ? [column.permission] : [])));
      columns = readable.filter((column) => dto.columns?.includes(column.key));
    }

    const scope = this.parseScope(dto.scope, exporter);
    const count = await exporter.count(scope, ctx);
    const max = tenantFeatureParam(DATA_TRANSFER_EXPORT_MAX_ROWS_PARAM);
    if (count > max) throw new AppException('DATA_TRANSFER_TOO_MANY_ROWS', { max, count });

    const created = await withTransaction(this.db, async (tx) => {
      if ((await this.repo.countActive(actor.id, tx)) >= DATA_TRANSFER_MAX_ACTIVE_PER_USER) {
        throw new AppException('DATA_TRANSFER_LIMIT_EXCEEDED', {
          max: DATA_TRANSFER_MAX_ACTIVE_PER_USER,
        });
      }
      const row = await this.repo.create(
        {
          direction: 'export',
          type: resource.type,
          mode: null,
          format: dto.format,
          status: 'queued',
          createdBy: actor.id,
          locale: ctx.locale,
          timezone: ctx.timezone,
          params: { scope, columns: columns.map((column) => column.key) },
          totalRows: count,
          expiresAt: this.lifecycle.pendingExpiresAt(),
        },
        tx,
      );
      await this.jobs.enqueue(DATA_TRANSFER_EXPORT_JOB, { transferId: row.id }, { tx });
      return row;
    });
    this.lifecycle.publish(created, ChangeKind.CREATE);
    return toTransferDto(created);
  }

  /** 匯入的套用列與結果（§7.7）；「以失敗的列重新匯入」取回原始 cells 用。 */
  async rows(id: string, query: ListTransferRowsDto, actor: AuthUser) {
    const transfer = await this.getOwned(id, actor);
    if (transfer.direction !== 'import') {
      throw new AppException('DATA_TRANSFER_INVALID_STATE', { status: transfer.status });
    }
    if (transfer.status === 'expired') throw new AppException('DATA_TRANSFER_EXPIRED');
    const rows = await this.repo.listRows(id, {
      outcome: query.outcome,
      afterRowNo: query.afterRowNo,
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({
        rowNo: row.rowNo,
        sourceRow: row.sourceRow,
        cells: row.raw,
        outcome: row.outcome as 'pending',
        error: row.outcomeError,
        changes: (row.changes as Record<string, [string, string]> | null) ?? null,
        resultId: row.resultId,
      })),
      nextRowNo: rows.length > query.limit ? (page.at(-1)?.rowNo ?? null) : null,
    };
  }

  /** 自己建立的傳輸；別人的與不存在的一樣回 404。 */
  async getOwned(id: string, actor: AuthUser): Promise<DataTransferRow> {
    const transfer = await this.repo.findById(id);
    if (!transfer || transfer.createdBy !== actor.id) {
      throw new AppException('DATA_TRANSFER_NOT_FOUND');
    }
    return transfer;
  }

  private parseScope(
    scope: CreateExportDto['scope'],
    exporter: NonNullable<ReturnType<DataTransferRegistry['require']>['exporter']>,
  ): ExportScope<unknown> {
    if (scope.kind === 'ids') {
      const invalid = scope.ids.filter((id) => !exporter.idSchema.safeParse(id).success);
      if (invalid.length)
        throw new AppException('VALIDATION_FAILED', { fields: { 'scope.ids': 'invalid id' } });
      return { kind: 'ids', ids: [...new Set(scope.ids)] };
    }
    const parsed = exporter.filterSchema.safeParse(scope.filter);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      this.logger.debug(`匯出的篩選條件不符：${parsed.error.message}`);
      throw new AppException('VALIDATION_FAILED', {
        fields: { [['filter', ...(issue?.path ?? [])].join('.')]: issue?.message ?? 'invalid' },
      });
    }
    exporter.assertFilter?.(parsed.data);
    return { kind: 'filter', filter: parsed.data };
  }
}
