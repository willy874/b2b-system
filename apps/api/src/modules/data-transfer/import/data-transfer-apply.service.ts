import { ChangeKind } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { TENANT_DB, withTransaction } from '@/core/database';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { getRequestContext, runWithRequestContext } from '@/core/http';
import type { JobContext } from '@/core/jobs';
import { dataTransferRows } from '@/core/metrics';
import type { DataTransferApplyRow, DataTransferRow } from '@/db/schema';
import { PermissionService } from '@/modules/permission/permission.service';

import { DataTransferRegistry } from '../data-transfer-registry.service';
import { isModifiable } from '../data-transfer.columns';
import {
  DATA_TRANSFER_EFFECT_FLUSH_INTERVAL_MS,
  DATA_TRANSFER_EFFECT_FLUSH_ROWS,
  DATA_TRANSFER_PROGRESS_INTERVAL_MS,
  DATA_TRANSFER_PROGRESS_ROWS,
  DATA_TRANSFER_RECHECK_ROWS,
} from '../data-transfer.constants';
import {
  DataTransferContextFactory,
  TransferOwnerUnavailableError,
} from '../data-transfer.context';
import { DATA_TRANSFER_APPLY_IMPORT_JOB } from '../data-transfer.job-types';
import { DataTransferLifecycle } from '../data-transfer.lifecycle';
import { DataTransferRepository } from '../data-transfer.repository';
import type {
  AfterCommitEffect,
  AnyTransferResource,
  ApplyResult,
  ImportMode,
  TransferContext,
} from '../data-transfer.types';
import { hasErrors, ImportValidator } from './import-validator';
import type { ValidatedRow } from './import-validator';
import { isSameFileRef, planSameFile, sameFileColumns, sameFileKeyOf } from './same-file';

/** 一次取回的套用列（重新驗證與套用都分批，避免整份放在記憶體兩次）。 */
const ROW_BATCH = 1000;
/** 取消旗標的檢查間隔（列數）：每列都查一次資料庫太貴，取消最多晚這麼多列生效。 */
const CANCEL_CHECK_ROWS = 20;
const MAX_CHANGES_PER_PUBLISH = 100;

interface ApplyParams {
  skipInvalid: boolean;
  columns: string[];
}

class ApplyStopped extends Error {
  constructor(readonly reason: 'cancelled' | 'forbidden') {
    super(reason);
  }
}

/**
 * 交易後的副作用合併執行（§7.6、D10）：每列各做一次 `permissionsChanged()` 就是每列一次全租戶失效，
 * 所以收集起來每 100 列或每 2 秒執行一次——權限失效只做一次、推播合併成每 100 筆一則、`custom` 依 key 去重。
 */
class EffectBuffer {
  private permissionsChanged = false;
  /** 合併的受影響者；有任何一筆沒帶（不知道是誰）時是 null：交給 `permissionsChanged()` 不帶參數。 */
  private permissionUserIds: Set<string> | null = new Set();
  private changes: ResourceChangeWire[] = [];
  private affected = new Set<string>();
  private custom = new Map<string, () => Promise<void> | void>();
  private rows = 0;
  private lastFlush = Date.now();

  constructor(
    private readonly permissions: PermissionService,
    private readonly events: DomainEventBus,
  ) {}

  add(effects: readonly AfterCommitEffect[] | undefined): void {
    this.rows += 1;
    for (const effect of effects ?? []) {
      if (effect.kind === 'permissionsChanged') {
        this.permissionsChanged = true;
        if (!effect.userIds) this.permissionUserIds = null;
        else for (const id of effect.userIds) this.permissionUserIds?.add(id);
      } else if (effect.kind === 'resourceChanged') {
        this.changes.push(effect.change);
        for (const id of effect.affectedUserIds ?? []) this.affected.add(id);
      } else this.custom.set(effect.key, effect.run);
    }
  }

  get due(): boolean {
    return (
      this.rows >= DATA_TRANSFER_EFFECT_FLUSH_ROWS ||
      (this.rows > 0 && Date.now() - this.lastFlush >= DATA_TRANSFER_EFFECT_FLUSH_INTERVAL_MS)
    );
  }

  async flush(): Promise<void> {
    const permissionsChanged = this.permissionsChanged;
    const permissionUserIds = this.permissionUserIds;
    const changes = this.changes;
    const affected = [...this.affected];
    const custom = [...this.custom.values()];
    this.permissionsChanged = false;
    this.permissionUserIds = new Set();
    this.changes = [];
    this.affected = new Set();
    this.custom = new Map();
    this.rows = 0;
    this.lastFlush = Date.now();
    // 規則 6：先失效再發佈
    if (permissionsChanged) {
      await this.permissions.permissionsChanged(
        permissionUserIds ? [...permissionUserIds] : undefined,
      );
    }
    for (const run of custom) await run();
    for (let index = 0; index < changes.length; index += MAX_CHANGES_PER_PUBLISH) {
      this.events.publish(DomainEvent.RESOURCE_CHANGED, {
        changes: changes.slice(index, index + MAX_CHANGES_PER_PUBLISH),
        ...(affected.length ? { affectedUserIds: affected } : {}),
      });
    }
  }
}

/**
 * `dataTransfer.applyImport`（docs/architecture/backend/22-data-transfer.md §7.6）：
 * 1. 以同一個驗證器重新驗證全部 `pending` 的列（加上檔案內重複與同一個目標多次）：前端送來的是客戶端資料。
 * 2. 依列號逐列套用，每列一個交易：業務寫入與該列的 `outcome` 在 **同一個交易** 提交（D9），重試只處理還是 `pending` 的列。
 * 3. 以建立者的身分執行（D20），每列的業務稽核帶 `via: 'import'`、`transferId`。
 */
@Injectable()
export class DataTransferApplyService {
  private readonly logger = new Logger(DataTransferApplyService.name);

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: DataTransferRepository,
    private readonly registry: DataTransferRegistry,
    private readonly contexts: DataTransferContextFactory,
    private readonly lifecycle: DataTransferLifecycle,
    private readonly validator: ImportValidator,
    private readonly permissions: PermissionService,
    private readonly events: DomainEventBus,
  ) {}

  async run(transferId: string, job: JobContext): Promise<object> {
    const queued = await this.repo.findById(transferId);
    if (!queued) return { skipped: 'notFound' };
    const transfer = await this.repo.transition(transferId, ['queued', 'applying'], {
      status: 'applying',
      startedAt: queued.startedAt ?? new Date(),
    });
    if (!transfer) return { skipped: queued.status };
    this.lifecycle.publish(transfer, ChangeKind.UPDATE);

    const resource = this.registry.find(transfer.type);
    if (!resource?.importer) {
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
      await this.repo.settlePending(transferId, 'failed', { code: 'AUTHZ_FORBIDDEN' });
      await this.lifecycle.fail(transferId, 'AUTHZ_FORBIDDEN', { reason: 'ownerUnavailable' });
      return { failed: 'AUTHZ_FORBIDDEN' };
    }
    try {
      return await this.contexts.runAs(ctx, job.id, () => this.apply(transfer, resource, ctx));
    } catch (error) {
      if (job.retryCount >= DATA_TRANSFER_APPLY_IMPORT_JOB.options.retryLimit) {
        await this.repo.settlePending(transferId, 'failed', { code: 'INTERNAL_ERROR' });
        await this.lifecycle.fail(
          transferId,
          error instanceof AppException ? error.code : 'INTERNAL_ERROR',
        );
      }
      throw error;
    }
  }

  private async apply(
    transfer: DataTransferRow,
    resource: AnyTransferResource,
    initialCtx: TransferContext,
  ): Promise<object> {
    const mode = (transfer.mode ?? 'create') as ImportMode;
    const params = transfer.params as unknown as ApplyParams;
    let ctx = initialCtx;
    const permissions = resource.importer?.modes[mode]?.permissions ?? [];
    const effects = new EffectBuffer(this.permissions, this.events);
    let stopped: ApplyStopped | null = null;

    try {
      if (!permissions.every((key) => ctx.can(key))) throw new ApplyStopped('forbidden');
      // 1. 重新驗證（重試時已經有 outcome 的列不再驗證）
      const pending = await this.loadPending(transfer.id);
      const validated = await this.validator.validate(
        resource,
        mode,
        pending.map((row) => ({
          rowNo: row.rowNo,
          cells: row.raw,
          // 預覽中手動指定（或撤回）的目標照用（§7.5）
          ...(row.targetManual ? { targetId: row.targetId } : {}),
        })),
        ctx,
        { crossRow: true },
      );
      const byRowNo = new Map(validated.map((row) => [row.rowNo, row]));
      const applicable: DataTransferApplyRow[] = [];
      for (const row of pending) {
        const result = byRowNo.get(row.rowNo);
        if (!result) continue;
        const outcome = this.preOutcome(row, result, mode, params.skipInvalid);
        if (outcome) await this.repo.setRowOutcome(transfer.id, row.rowNo, outcome);
        else applicable.push(row);
      }

      // 2. 逐列套用；同檔引用的列排在被引用的列之後（§7.8）
      const { ordered, created } = await this.planSameFile(
        transfer.id,
        resource,
        applicable,
        byRowNo,
      );
      let processed = 0;
      let reportedAt = Date.now();
      let reportedRows = 0;
      for (const row of ordered) {
        if (processed % CANCEL_CHECK_ROWS === 0) {
          const current = await this.repo.findById(transfer.id);
          if (current?.status !== 'applying') throw new ApplyStopped('cancelled');
        }
        if (processed > 0 && processed % DATA_TRANSFER_RECHECK_ROWS === 0) {
          ctx = await this.contexts.refresh(ctx);
          if (!permissions.every((key) => ctx.can(key))) throw new ApplyStopped('forbidden');
        }
        const result = byRowNo.get(row.rowNo);
        if (result && (await this.resolveSameFile(transfer.id, resource, row, result, created))) {
          const id = await this.applyRow(transfer, resource, mode, row, result, ctx, effects);
          if (id) this.rememberCreated(resource, row, id, created);
        }
        processed += 1;
        if (effects.due) await effects.flush();
        if (
          processed - reportedRows >= DATA_TRANSFER_PROGRESS_ROWS ||
          Date.now() - reportedAt >= DATA_TRANSFER_PROGRESS_INTERVAL_MS
        ) {
          reportedRows = processed;
          reportedAt = Date.now();
          await this.reportProgress(transfer);
        }
      }
    } catch (error) {
      if (!(error instanceof ApplyStopped)) {
        await effects.flush();
        throw error;
      }
      stopped = error;
    }
    await effects.flush();

    if (stopped?.reason === 'cancelled') {
      await this.repo.settlePending(transfer.id, 'cancelled', null);
      const counts = await this.repo.countOutcomes(transfer.id);
      await this.repo.updateCounts(transfer.id, {
        processedRows: transfer.totalRows - counts.cancelled,
        succeededRows: counts.succeeded,
        failedRows: counts.failed,
        skippedRows: counts.skipped,
      });
      const cancelled = await this.repo.findById(transfer.id);
      if (cancelled) this.lifecycle.publish(cancelled, ChangeKind.UPDATE);
      return { cancelled: true };
    }
    if (stopped?.reason === 'forbidden') {
      // 權限中途被拿掉：未處理的列失敗，傳輸照常完成並在報告中說明（§7.6）
      await this.repo.settlePending(transfer.id, 'failed', { code: 'AUTHZ_FORBIDDEN' });
    }
    return this.complete(transfer);
  }

  private async loadPending(transferId: string): Promise<DataTransferApplyRow[]> {
    const rows: DataTransferApplyRow[] = [];
    let after: number | undefined;
    for (;;) {
      const page = await this.repo.listRows(transferId, {
        outcome: ['pending'],
        afterRowNo: after,
        limit: ROW_BATCH,
      });
      rows.push(...page);
      if (page.length < ROW_BATCH) return rows;
      after = page.at(-1)?.rowNo;
    }
  }

  /** 套用前就能決定結果的列：驗證失敗、比對到的目標與預覽時不同、修改模式沒有變更。 */
  private preOutcome(
    row: DataTransferApplyRow,
    result: ValidatedRow,
    mode: ImportMode,
    skipInvalid: boolean,
  ): Parameters<DataTransferRepository['setRowOutcome']>[2] | null {
    if (hasErrors(result)) {
      // 正常操作下前端不會送出有錯誤的列；會走到這裡的，是預覽之後資料庫變了
      return skipInvalid
        ? { outcome: 'skipped', outcomeError: { code: 'VALIDATION_FAILED', issues: result.issues } }
        : { outcome: 'failed', outcomeError: { code: 'VALIDATION_FAILED', issues: result.issues } };
    }
    if (mode === 'update') {
      if (row.targetId && result.target && result.target.id !== row.targetId) {
        return {
          outcome: 'failed',
          outcomeError: {
            code: 'VALIDATION_FAILED',
            issues: [{ column: null, code: 'targetNotFound', severity: 'error' }],
          },
        };
      }
      if (!result.changed?.length) return { outcome: 'skipped', outcomeError: null };
    }
    return null;
  }

  private async applyRow(
    transfer: DataTransferRow,
    resource: AnyTransferResource,
    mode: ImportMode,
    row: DataTransferApplyRow,
    result: ValidatedRow,
    ctx: TransferContext,
    effects: EffectBuffer,
  ): Promise<string | null> {
    const importer = resource.importer;
    if (!importer) return null;
    const metadata = {
      ...getRequestContext()?.auditMetadata,
      via: 'import',
      transferId: transfer.id,
    };
    const context = getRequestContext();
    const run = <T>(fn: () => Promise<T>): Promise<T> =>
      context ? runWithRequestContext({ ...context, auditMetadata: metadata }, fn) : fn();
    try {
      const applied = await run(() =>
        withTransaction(this.db, async (tx) => {
          let applyResult: ApplyResult;
          let changes: Record<string, [string, string]> | null = null;
          if (mode === 'create') {
            if (!importer.create) throw new AppException('DATA_TRANSFER_TYPE_UNSUPPORTED');
            applyResult = await importer.create(result.values, ctx, tx);
          } else {
            const target = result.target;
            if (!importer.update || !target)
              throw new AppException('DATA_TRANSFER_TYPE_UNSUPPORTED');
            const patch: Record<string, unknown> = {};
            changes = {};
            for (const key of result.changed ?? []) {
              const column = resource.columns.find((item) => item.key === key);
              if (!column || !isModifiable(column, 'update')) continue;
              patch[key] = result.values[key];
              changes[key] = [result.current?.[key] ?? '', result.texts[key] ?? ''];
            }
            // 前端送回的 version 與 expected 只是樂觀鎖的輸入：預覽之後別人改過 → 這一列衝突，不蓋掉別人的修改
            applyResult = await importer.update(
              {
                id: target.id,
                version: row.targetVersion ?? target.version,
                ...((row.targetExpected ?? target.expected)
                  ? { expected: row.targetExpected ?? target.expected }
                  : {}),
              },
              patch,
              ctx,
              tx,
            );
          }
          await this.repo.setRowOutcome(
            transfer.id,
            row.rowNo,
            { outcome: 'succeeded', resultId: applyResult.id, changes, outcomeError: null },
            tx,
          );
          return applyResult;
        }),
      );
      effects.add(applied.after);
      return applied.id;
    } catch (error) {
      const outcomeError =
        error instanceof AppException
          ? { code: error.code, ...(error.details ? { details: error.details } : {}) }
          : { code: 'INTERNAL_ERROR' };
      if (!(error instanceof AppException)) {
        this.logger.error(
          { err: error, transferId: transfer.id, rowNo: row.rowNo },
          '匯入的一列套用失敗',
        );
      }
      await this.repo.setRowOutcome(transfer.id, row.rowNo, { outcome: 'failed', outcomeError });
      return null;
    }
  }

  /**
   * 同檔引用（§7.8）的套用順序：被引用的列先套用。在循環裡的列（驗證時已標錯，這裡是保險）直接失敗。
   * `created` 記下這次建立的紀錄：被引用的值 → id。
   */
  private async planSameFile(
    transferId: string,
    resource: AnyTransferResource,
    rows: readonly DataTransferApplyRow[],
    byRowNo: ReadonlyMap<number, ValidatedRow>,
  ): Promise<{ ordered: DataTransferApplyRow[]; created: Map<string, string> }> {
    const created = new Map<string, string>();
    const columns = sameFileColumns(resource);
    if (!columns.length) return { ordered: [...rows], created };
    const { ordered, cyclic } = planSameFile(
      rows,
      (row) =>
        columns.flatMap((column) => {
          const value = byRowNo.get(row.rowNo)?.values[column.key];
          return isSameFileRef(value) ? [value.key] : [];
        }),
      (row) => this.sameFileKeys(resource, row),
    );
    for (const row of cyclic) {
      await this.repo.setRowOutcome(transferId, row.rowNo, {
        outcome: 'failed',
        outcomeError: {
          code: 'VALIDATION_FAILED',
          issues: [{ column: null, code: 'referenceCycle', severity: 'error' }],
        },
      });
    }
    return { ordered, created };
  }

  /** 一列可以被引用的值（正規化後）：每個同檔引用指向的欄。 */
  private sameFileKeys(resource: AnyTransferResource, row: DataTransferApplyRow): string[] {
    return sameFileColumns(resource).flatMap((column) => {
      const key = sameFileKeyOf(row.raw, column.reference?.sameFile?.column ?? '');
      return key ? [key] : [];
    });
  }

  private rememberCreated(
    resource: AnyTransferResource,
    row: DataTransferApplyRow,
    id: string,
    created: Map<string, string>,
  ): void {
    for (const key of this.sameFileKeys(resource, row)) created.set(key, id);
  }

  /** 把佔位值換成被引用的列建立出來的 id；那一列沒有成功時這一列失敗（`referenceFailed`）。 */
  private async resolveSameFile(
    transferId: string,
    resource: AnyTransferResource,
    row: DataTransferApplyRow,
    result: ValidatedRow,
    created: ReadonlyMap<string, string>,
  ): Promise<boolean> {
    for (const column of sameFileColumns(resource)) {
      const value = result.values[column.key];
      if (!isSameFileRef(value)) continue;
      const id = created.get(value.key);
      if (id) {
        result.values[column.key] = id;
        continue;
      }
      await this.repo.setRowOutcome(transferId, row.rowNo, {
        outcome: 'failed',
        outcomeError: {
          code: 'VALIDATION_FAILED',
          issues: [
            {
              column: column.key,
              code: 'referenceFailed',
              params: { value: result.texts[column.key] ?? value.key },
              severity: 'error',
            },
          ],
        },
      });
      return false;
    }
    return true;
  }

  private async reportProgress(transfer: DataTransferRow): Promise<void> {
    const counts = await this.repo.countOutcomes(transfer.id);
    const current = await this.repo.updateProgress(transfer.id, 'applying', {
      processedRows: transfer.totalRows - counts.pending,
      succeededRows: counts.succeeded,
      failedRows: counts.failed,
      skippedRows: counts.skipped,
    });
    if (current) this.lifecycle.publish(current, ChangeKind.UPDATE);
  }

  private async complete(transfer: DataTransferRow): Promise<object> {
    const counts = await this.repo.countOutcomes(transfer.id);
    const finishedAt = new Date();
    const expiresAt = await this.lifecycle.expiresAt(finishedAt);
    const completed = await withTransaction(this.db, async (tx) => {
      const row = await this.repo.transition(
        transfer.id,
        ['applying'],
        {
          status: 'completed',
          processedRows: transfer.totalRows,
          succeededRows: counts.succeeded,
          failedRows: counts.failed + counts.cancelled,
          skippedRows: counts.skipped,
          finishedAt,
          expiresAt,
        },
        { tx },
      );
      if (!row) return undefined;
      await this.lifecycle.record(
        'dataTransfer.import',
        row,
        {
          type: row.type,
          mode: row.mode,
          total: row.totalRows,
          succeeded: row.succeededRows,
          failed: row.failedRows,
          skipped: row.skippedRows,
          fileName: row.sourceName,
        },
        tx,
      );
      await this.lifecycle.notifyFinished(row, tx);
      return row;
    });
    if (!completed) return { cancelled: true };
    for (const [result, value] of [
      ['succeeded', counts.succeeded],
      ['failed', counts.failed],
      ['skipped', counts.skipped],
    ] as const) {
      if (value) dataTransferRows.inc({ direction: 'import', type: transfer.type, result }, value);
    }
    this.lifecycle.publish(completed, ChangeKind.UPDATE);
    return { succeeded: counts.succeeded, failed: counts.failed, skipped: counts.skipped };
  }
}
