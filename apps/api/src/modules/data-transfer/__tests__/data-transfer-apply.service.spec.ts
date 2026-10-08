import { ChangeKind } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/common/types';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import { getRequestContext, runWithRequestContext } from '@/core/http';
import type { JobContext } from '@/core/jobs';
import { dataTransferRows } from '@/core/metrics';
import type { DataTransferApplyRow, DataTransferRow } from '@/db/schema';
import type { PermissionService } from '@/modules/permission/permission.service';

import type { DataTransferRegistry } from '../data-transfer-registry.service';
import {
  DATA_TRANSFER_EFFECT_FLUSH_INTERVAL_MS,
  DATA_TRANSFER_PROGRESS_INTERVAL_MS,
} from '../data-transfer.constants';
import { TransferOwnerUnavailableError } from '../data-transfer.context';
import type { DataTransferContextFactory } from '../data-transfer.context';
import type { DataTransferLifecycle } from '../data-transfer.lifecycle';
import type { DataTransferRepository } from '../data-transfer.repository';
import type {
  AfterCommitEffect,
  AnyTransferResource,
  ApplyResult,
  TransferColumn,
  TransferContext,
  TransferImporter,
} from '../data-transfer.types';
import { DataTransferApplyService } from '../import/data-transfer-apply.service';
import type { ImportValidator, ValidatedRow } from '../import/import-validator';
import { sameFileRef } from '../import/same-file';

const SPEC = 'docs/architecture/backend/22-data-transfer.md';
const IMPORT = 'widget:import' as PermissionKey;

function transfer(overrides: Partial<DataTransferRow> = {}): DataTransferRow {
  return {
    id: 'transfer-1',
    direction: 'import',
    type: 'widget',
    mode: 'create',
    format: 'csv',
    status: 'applying',
    createdBy: 'user-1',
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    params: { skipInvalid: false, columns: ['name'] },
    sourceName: 'widgets.csv',
    outputKey: null,
    outputName: null,
    outputSize: null,
    totalRows: 0,
    processedRows: 0,
    succeededRows: 0,
    failedRows: 0,
    skippedRows: 0,
    errorCode: null,
    errorDetails: null,
    version: 1,
    expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-10-08T06:30:00.000Z'),
    updatedAt: new Date('2026-10-08T06:30:00.000Z'),
    ...overrides,
  };
}

function applyRow(
  rowNo: number,
  overrides: Partial<DataTransferApplyRow> = {},
): DataTransferApplyRow {
  return {
    transferId: 'transfer-1',
    rowNo,
    sourceRow: rowNo + 1,
    raw: { name: `w${rowNo}` },
    targetId: null,
    targetVersion: null,
    targetManual: false,
    targetExpected: null,
    outcome: 'pending',
    outcomeError: null,
    changes: null,
    resultId: null,
    updatedAt: new Date('2026-10-08T06:30:00.000Z'),
    ...overrides,
  };
}

function validated(rowNo: number, overrides: Partial<ValidatedRow> = {}): ValidatedRow {
  return {
    rowNo,
    issues: [],
    values: { name: `w${rowNo}` },
    texts: { name: `w${rowNo}` },
    ...overrides,
  };
}

function context(granted: readonly PermissionKey[] = [IMPORT]): TransferContext {
  const keys = new Set<string>(granted);
  return {
    actor: { id: 'user-1', email: 'owner@example.com', status: 'active' },
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    signal: new AbortController().signal,
    can: (key) => keys.has(key),
  };
}

const NAME: TransferColumn<unknown> = {
  key: 'name',
  label: { 'zh-TW': '名稱', 'en-US': 'Name' },
  kind: 'string',
  import: { modes: ['create', 'update'], schema: {} as never },
};
const ID: TransferColumn<unknown> = {
  key: 'id',
  label: { 'zh-TW': 'ID', 'en-US': 'ID' },
  kind: 'string',
  import: { modes: ['update'], matchKey: 1, schema: {} as never },
};
const CODE: TransferColumn<unknown> = { ...NAME, key: 'code' };
const PARENT: TransferColumn<unknown> = {
  ...NAME,
  key: 'parent',
  kind: 'reference',
  reference: {
    resolve: vi.fn(),
    search: vi.fn(),
    sameFile: { column: 'code' },
  },
};

function widgetResource(
  importer: Partial<TransferImporter<unknown>> = {},
  columns: TransferColumn<unknown>[] = [ID, NAME],
): AnyTransferResource {
  return {
    type: 'widget',
    fileBaseName: 'widgets',
    label: { 'zh-TW': '小工具', 'en-US': 'Widgets' },
    columns,
    importer: {
      modes: { create: { permissions: [IMPORT] }, update: { permissions: [IMPORT] } },
      create: vi.fn(async (values: Readonly<Record<string, unknown>>) => ({
        id: `id-${String(values.name)}`,
      })),
      update: vi.fn(async (target: { id: string }) => ({ id: target.id })),
      ...importer,
    },
  };
}

const COUNTS = { pending: 0, succeeded: 0, failed: 0, skipped: 0, cancelled: 0 };

interface SetupOptions {
  transfer?: DataTransferRow;
  rows?: DataTransferApplyRow[];
  results?: ValidatedRow[];
  resource?: AnyTransferResource | undefined;
  ctx?: TransferContext;
  counts?: Partial<typeof COUNTS>;
}

function setup(options: SetupOptions = {}) {
  const current = options.transfer ?? transfer();
  const rows = options.rows ?? [];
  const tx = { name: 'tx' };
  const db = { transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    findById: vi.fn(async (): Promise<DataTransferRow | undefined> => current),
    transition: vi.fn(
      async (_id: string, _from: readonly string[], values: Partial<DataTransferRow>) =>
        ({ ...current, ...values }) as DataTransferRow | undefined,
    ),
    settlePending: vi.fn(async () => undefined),
    listRows: vi.fn(async (_id: string, query: { afterRowNo?: number; limit: number }) =>
      rows.filter((row) => row.rowNo > (query.afterRowNo ?? 0)).slice(0, query.limit),
    ),
    setRowOutcome: vi.fn(async () => undefined),
    countOutcomes: vi.fn(async () => ({ ...COUNTS, ...options.counts })),
    updateCounts: vi.fn(async () => undefined),
    updateProgress: vi.fn(async (): Promise<DataTransferRow | undefined> => current),
  };
  const resource = 'resource' in options ? options.resource : widgetResource();
  const registry = { find: vi.fn(() => resource) };
  const ctx = options.ctx ?? context();
  const contexts = {
    forJob: vi.fn(async () => ctx),
    runAs: vi.fn((_ctx: TransferContext, _jobId: string, fn: () => Promise<object>) => fn()),
    refresh: vi.fn(async (value: TransferContext) => value),
  };
  const lifecycle = {
    publish: vi.fn(),
    fail: vi.fn(async () => undefined),
    expiresAt: vi.fn(async () => new Date('2027-01-01T00:00:00.000Z')),
    record: vi.fn(async () => undefined),
    notifyFinished: vi.fn(async () => undefined),
  };
  const validator = {
    validate: vi.fn(async () => options.results ?? rows.map((row) => validated(row.rowNo))),
  };
  const permissions = { permissionsChanged: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  const service = new DataTransferApplyService(
    db as unknown as Database,
    repo as unknown as DataTransferRepository,
    registry as unknown as DataTransferRegistry,
    contexts as unknown as DataTransferContextFactory,
    lifecycle as unknown as DataTransferLifecycle,
    validator as unknown as ImportValidator,
    permissions as unknown as PermissionService,
    events as unknown as DomainEventBus,
  );
  return {
    service,
    db,
    tx,
    repo,
    registry,
    contexts,
    lifecycle,
    validator,
    permissions,
    events,
    resource,
  };
}

function job(retryCount = 0): JobContext {
  return { id: 'job-1', retryCount, signal: new AbortController().signal };
}

function rowsOf(count: number): DataTransferApplyRow[] {
  return Array.from({ length: count }, (_, index) => applyRow(index + 1));
}

/** 該列第一次被記下的 outcome。 */
function outcomeOf(repo: ReturnType<typeof setup>['repo'], rowNo: number) {
  return (repo.setRowOutcome.mock.calls as unknown[][]).find((call) => call[1] === rowNo)?.[2];
}

function change(id: string): ResourceChangeWire {
  return { resource: 'widget', id, kind: ChangeKind.CREATE } as unknown as ResourceChangeWire;
}

function referenceFailed(column: string, value: string) {
  return {
    outcome: 'failed',
    outcomeError: {
      code: 'VALIDATION_FAILED',
      issues: [{ column, code: 'referenceFailed', params: { value }, severity: 'error' }],
    },
  };
}

let now = new Date('2026-10-08T08:00:00.000Z').getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  now = new Date('2026-10-08T08:00:00.000Z').getTime();
  vi.setSystemTime(now);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function advance(ms: number): void {
  now += ms;
  vi.setSystemTime(now);
}

describe(`DataTransferApplyService.run：開始前（${SPEC} §7.6）`, () => {
  it('傳輸不存在時略過', async () => {
    const { service, repo } = setup();
    repo.findById.mockResolvedValueOnce(undefined);
    await expect(service.run('transfer-1', job())).resolves.toEqual({ skipped: 'notFound' });
    expect(repo.transition).not.toHaveBeenCalled();
  });

  it('狀態不是 queued／applying（例：已取消）時略過並回報當時的狀態', async () => {
    const { service, repo, lifecycle } = setup({ transfer: transfer({ status: 'cancelled' }) });
    repo.transition.mockResolvedValueOnce(undefined);
    await expect(service.run('transfer-1', job())).resolves.toEqual({ skipped: 'cancelled' });
    expect(lifecycle.publish).not.toHaveBeenCalled();
  });

  it('轉成 applying：第一次執行記下開始時間，重試保留原本的開始時間', async () => {
    const first = setup({ transfer: transfer({ status: 'queued' }) });
    await first.service.run('transfer-1', job());
    expect(first.repo.transition).toHaveBeenNthCalledWith(1, 'transfer-1', ['queued', 'applying'], {
      status: 'applying',
      startedAt: new Date(now),
    });
    expect(first.lifecycle.publish).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ status: 'applying' }),
      ChangeKind.UPDATE,
    );

    const startedAt = new Date('2026-10-08T07:00:00.000Z');
    const retry = setup({ transfer: transfer({ startedAt }) });
    await retry.service.run('transfer-1', job(1));
    expect(retry.repo.transition).toHaveBeenNthCalledWith(1, 'transfer-1', ['queued', 'applying'], {
      status: 'applying',
      startedAt,
    });
  });

  it.each([
    ['沒有登記', undefined],
    ['沒有 importer', { ...widgetResource(), importer: undefined }],
  ])('資源%s時傳輸以 DATA_TRANSFER_TYPE_UNSUPPORTED 失敗', async (_name, resource) => {
    const { service, lifecycle, contexts } = setup({ resource });
    await expect(service.run('transfer-1', job())).resolves.toEqual({
      failed: 'DATA_TRANSFER_TYPE_UNSUPPORTED',
    });
    expect(lifecycle.fail).toHaveBeenCalledExactlyOnceWith(
      'transfer-1',
      'DATA_TRANSFER_TYPE_UNSUPPORTED',
      {
        type: 'widget',
      },
    );
    expect(contexts.forJob).not.toHaveBeenCalled();
  });

  it('建立者已停用或刪除：未處理的列與傳輸都以 AUTHZ_FORBIDDEN 失敗（D20）', async () => {
    const { service, repo, lifecycle, contexts } = setup();
    contexts.forJob.mockRejectedValueOnce(new TransferOwnerUnavailableError());
    await expect(service.run('transfer-1', job())).resolves.toEqual({ failed: 'AUTHZ_FORBIDDEN' });
    expect(repo.settlePending).toHaveBeenCalledExactlyOnceWith('transfer-1', 'failed', {
      code: 'AUTHZ_FORBIDDEN',
    });
    expect(lifecycle.fail).toHaveBeenCalledExactlyOnceWith('transfer-1', 'AUTHZ_FORBIDDEN', {
      reason: 'ownerUnavailable',
    });
  });

  it('重建脈絡的其他錯誤原樣拋出（交給工作重試）', async () => {
    const { service, contexts, lifecycle } = setup();
    const boom = new Error('db down');
    contexts.forJob.mockRejectedValueOnce(boom);
    await expect(service.run('transfer-1', job())).rejects.toBe(boom);
    expect(lifecycle.fail).not.toHaveBeenCalled();
  });

  it('以建立者的身分執行套用', async () => {
    const { service, contexts } = setup();
    await service.run('transfer-1', job());
    expect(contexts.runAs).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      'job-1',
      expect.any(Function),
    );
  });
});

describe(`DataTransferApplyService.run：套用中途的錯誤（${SPEC} §7.6）`, () => {
  it('還能重試時原樣拋出、不結束傳輸', async () => {
    const { service, repo, lifecycle } = setup();
    const boom = new Error('connection reset');
    repo.listRows.mockRejectedValueOnce(boom);
    await expect(service.run('transfer-1', job(4))).rejects.toBe(boom);
    expect(repo.settlePending).not.toHaveBeenCalled();
    expect(lifecycle.fail).not.toHaveBeenCalled();
  });

  it.each([
    ['AppException 帶出錯誤碼', new AppException('DATA_TRANSFER_EXPIRED'), 'DATA_TRANSFER_EXPIRED'],
    ['其他錯誤是 INTERNAL_ERROR', new Error('boom'), 'INTERNAL_ERROR'],
  ])('最後一次重試仍失敗：未處理的列失敗、傳輸失敗（%s）', async (_name, error, code) => {
    const { service, repo, lifecycle } = setup();
    repo.listRows.mockRejectedValueOnce(error);
    await expect(service.run('transfer-1', job(5))).rejects.toBe(error);
    expect(repo.settlePending).toHaveBeenCalledExactlyOnceWith('transfer-1', 'failed', {
      code: 'INTERNAL_ERROR',
    });
    expect(lifecycle.fail).toHaveBeenCalledExactlyOnceWith('transfer-1', code);
  });

  it('拋出前先執行已累積的交易後副作用', async () => {
    const effects: AfterCommitEffect[] = [{ kind: 'permissionsChanged' }];
    // 第一列套用後時間已到進度回報的間隔（還沒到副作用的間隔），進度回報時資料庫出錯
    const create = vi.fn(async (): Promise<ApplyResult> => {
      advance(DATA_TRANSFER_PROGRESS_INTERVAL_MS);
      return { id: 'w1', after: effects };
    });
    const { service, repo, permissions } = setup({
      rows: rowsOf(2),
      resource: widgetResource({ create }),
    });
    const boom = new Error('db down');
    repo.countOutcomes.mockRejectedValueOnce(boom);
    await expect(service.run('transfer-1', job())).rejects.toBe(boom);
    expect(create).toHaveBeenCalledTimes(1);
    expect(permissions.permissionsChanged).toHaveBeenCalledExactlyOnceWith(undefined);
  });
});

describe(`DataTransferApplyService：重新驗證與套用前的結果（${SPEC} §7.6）`, () => {
  it('依列號分批讀取 pending 的列，手動指定的目標照用', async () => {
    const rows = [
      ...rowsOf(1000),
      applyRow(1001, { targetManual: true, targetId: 'manual-1' }),
      applyRow(1002, { targetManual: true, targetId: null }),
    ];
    const { service, repo, validator } = setup({ rows, results: [] });
    await service.run('transfer-1', job());
    expect(repo.listRows).toHaveBeenNthCalledWith(1, 'transfer-1', {
      outcome: ['pending'],
      afterRowNo: undefined,
      limit: 1000,
    });
    expect(repo.listRows).toHaveBeenNthCalledWith(2, 'transfer-1', {
      outcome: ['pending'],
      afterRowNo: 1000,
      limit: 1000,
    });
    const inputs = (validator.validate.mock.calls[0] as unknown[])[2] as unknown[];
    expect(inputs).toHaveLength(1002);
    expect(inputs[0]).toEqual({ rowNo: 1, cells: { name: 'w1' } });
    expect(inputs[1000]).toEqual({ rowNo: 1001, cells: { name: 'w1001' }, targetId: 'manual-1' });
    expect(inputs[1001]).toEqual({ rowNo: 1002, cells: { name: 'w1002' }, targetId: null });
    expect((validator.validate.mock.calls[0] as unknown[])[4]).toEqual({ crossRow: true });
  });

  it('mode 沒填時以新增模式驗證與套用', async () => {
    const { service, validator, resource } = setup({
      transfer: transfer({ mode: null }),
      rows: rowsOf(1),
    });
    await service.run('transfer-1', job());
    expect((validator.validate.mock.calls[0] as unknown[])[1]).toBe('create');
    expect(resource?.importer?.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    [false, 'failed'],
    [true, 'skipped'],
  ])('重新驗證有錯誤的列：skipInvalid=%s 時記為 %s，不套用', async (skipInvalid, outcome) => {
    const issues = [{ column: 'name', code: 'required', severity: 'error' as const }];
    const { service, repo, resource } = setup({
      transfer: transfer({ params: { skipInvalid, columns: ['name'] } }),
      rows: rowsOf(1),
      results: [validated(1, { issues })],
    });
    await service.run('transfer-1', job());
    expect(outcomeOf(repo, 1)).toEqual({
      outcome,
      outcomeError: { code: 'VALIDATION_FAILED', issues },
    });
    expect(resource?.importer?.create).not.toHaveBeenCalled();
  });

  it('驗證結果裡沒有的列不處理', async () => {
    const { service, repo, resource } = setup({ rows: rowsOf(2), results: [validated(2)] });
    await service.run('transfer-1', job());
    expect(resource?.importer?.create).toHaveBeenCalledTimes(1);
    expect(outcomeOf(repo, 1)).toBeUndefined();
  });

  it('修改模式：比對到的目標與預覽時不同的列以 targetNotFound 失敗', async () => {
    const { service, repo, resource } = setup({
      transfer: transfer({ mode: 'update' }),
      rows: [applyRow(1, { targetId: 'u1' })],
      results: [
        validated(1, {
          target: { id: 'u2', label: 'U2', version: 1, record: {} },
          changed: ['name'],
        }),
      ],
    });
    await service.run('transfer-1', job());
    expect(outcomeOf(repo, 1)).toEqual({
      outcome: 'failed',
      outcomeError: {
        code: 'VALIDATION_FAILED',
        issues: [{ column: null, code: 'targetNotFound', severity: 'error' }],
      },
    });
    expect(resource?.importer?.update).not.toHaveBeenCalled();
  });

  it('修改模式：沒有變更的列略過', async () => {
    const { service, repo } = setup({
      transfer: transfer({ mode: 'update' }),
      rows: [applyRow(1, { targetId: 'u1' })],
      results: [validated(1, { target: { id: 'u1', label: 'U1', version: 1, record: {} } })],
    });
    await service.run('transfer-1', job());
    expect(outcomeOf(repo, 1)).toEqual({ outcome: 'skipped', outcomeError: null });
  });

  it('沒有開始套用的權限時，未處理的列以 AUTHZ_FORBIDDEN 失敗，傳輸照常完成', async () => {
    const { service, repo, validator, lifecycle } = setup({ rows: rowsOf(1), ctx: context([]) });
    await expect(service.run('transfer-1', job())).resolves.toEqual({
      succeeded: 0,
      failed: 0,
      skipped: 0,
    });
    expect(validator.validate).not.toHaveBeenCalled();
    expect(repo.settlePending).toHaveBeenCalledExactlyOnceWith('transfer-1', 'failed', {
      code: 'AUTHZ_FORBIDDEN',
    });
    expect(lifecycle.record).toHaveBeenCalledTimes(1);
  });

  it('模式沒有登記權限時不檢查權限', async () => {
    const resource = widgetResource({ modes: {} });
    const { service, resource: used } = setup({ rows: rowsOf(1), resource, ctx: context([]) });
    await service.run('transfer-1', job());
    expect(used?.importer?.create).toHaveBeenCalledTimes(1);
  });
});

describe(`DataTransferApplyService：逐列套用（${SPEC} §7.6、D9、D20）`, () => {
  it('新增模式：業務寫入與該列的 succeeded 在同一個交易', async () => {
    const { service, repo, tx, resource } = setup({ rows: rowsOf(1) });
    await service.run('transfer-1', job());
    expect(resource?.importer?.create).toHaveBeenCalledExactlyOnceWith(
      { name: 'w1' },
      expect.anything(),
      tx,
    );
    expect(repo.setRowOutcome).toHaveBeenCalledExactlyOnceWith(
      'transfer-1',
      1,
      { outcome: 'succeeded', resultId: 'id-w1', changes: null, outcomeError: null },
      tx,
    );
  });

  it('有 request context 時，業務稽核的 metadata 帶 via: import 與 transferId', async () => {
    let metadata: unknown;
    const resource = widgetResource({
      create: vi.fn(async () => {
        metadata = getRequestContext()?.auditMetadata;
        return { id: 'w1' };
      }),
    });
    const { service, contexts } = setup({ rows: rowsOf(1), resource });
    contexts.runAs.mockImplementation((_ctx, _jobId, fn) =>
      runWithRequestContext({ requestId: 'job:job-1', auditMetadata: { source: 'job' } }, fn),
    );
    await service.run('transfer-1', job());
    expect(metadata).toEqual({ source: 'job', via: 'import', transferId: 'transfer-1' });
  });

  it('修改模式：只送出可修改的變更欄位，記下原值與新值，以預覽時的 version 與 expected 當樂觀鎖', async () => {
    const update = vi.fn(async (): Promise<ApplyResult> => ({ id: 'u1' }));
    const resource = widgetResource({ update });
    const { service, repo, tx } = setup({
      transfer: transfer({ mode: 'update' }),
      resource,
      rows: [
        applyRow(1, { targetId: 'u1', targetVersion: 7, targetExpected: { roleIds: ['r1'] } }),
      ],
      results: [
        validated(1, {
          target: { id: 'u1', label: 'U1', version: 9, record: {}, expected: { roleIds: ['r2'] } },
          values: { id: 'u1', name: 'New', unknown: 'x' },
          texts: { name: 'New' },
          current: { name: 'Old' },
          changed: ['id', 'name', 'unknown'],
        }),
      ],
    });
    await service.run('transfer-1', job());
    expect(update).toHaveBeenCalledExactlyOnceWith(
      { id: 'u1', version: 7, expected: { roleIds: ['r1'] } },
      { name: 'New' },
      expect.anything(),
      tx,
    );
    expect(repo.setRowOutcome).toHaveBeenCalledWith(
      'transfer-1',
      1,
      {
        outcome: 'succeeded',
        resultId: 'u1',
        changes: { name: ['Old', 'New'] },
        outcomeError: null,
      },
      tx,
    );
  });

  it('修改模式：預覽沒有記下 version、expected 時用重新比對的值；都沒有 expected 時不送', async () => {
    const update = vi.fn(async (): Promise<ApplyResult> => ({ id: 'u1' }));
    const results = [
      validated(1, {
        target: { id: 'u1', label: 'U1', version: 9, record: {}, expected: { roleIds: ['r2'] } },
        changed: ['name'],
      }),
      validated(2, {
        target: { id: 'u2', label: 'U2', version: 4, record: {} },
        changed: ['name'],
      }),
    ];
    const { service, repo, tx } = setup({
      transfer: transfer({ mode: 'update' }),
      resource: widgetResource({ update }),
      rows: rowsOf(2),
      results,
    });
    await service.run('transfer-1', job());
    expect(update).toHaveBeenNthCalledWith(
      1,
      { id: 'u1', version: 9, expected: { roleIds: ['r2'] } },
      { name: 'w1' },
      expect.anything(),
      tx,
    );
    expect(update).toHaveBeenNthCalledWith(
      2,
      { id: 'u2', version: 4 },
      { name: 'w2' },
      expect.anything(),
      tx,
    );
    // 沒有目前值與新值文字時以空字串記錄
    expect(repo.setRowOutcome).toHaveBeenCalledWith(
      'transfer-1',
      2,
      expect.objectContaining({ changes: { name: ['', 'w2'] } }),
      tx,
    );
  });

  it.each([
    ['新增模式沒有 create', 'create', { create: undefined }, validated(1)],
    [
      '修改模式沒有 update',
      'update',
      { update: undefined },
      validated(1, {
        target: { id: 'u1', label: 'U1', version: 1, record: {} },
        changed: ['name'],
      }),
    ],
    ['修改模式沒有目標', 'update', {}, validated(1, { changed: ['name'] })],
  ] as const)(
    '%s：該列以 DATA_TRANSFER_TYPE_UNSUPPORTED 失敗',
    async (_name, mode, importer, result) => {
      const { service, repo } = setup({
        transfer: transfer({ mode }),
        resource: widgetResource(importer),
        rows: rowsOf(1),
        results: [result],
      });
      await service.run('transfer-1', job());
      expect(outcomeOf(repo, 1)).toEqual({
        outcome: 'failed',
        outcomeError: { code: 'DATA_TRANSFER_TYPE_UNSUPPORTED' },
      });
    },
  );

  it.each([
    [
      '業務錯誤帶 details',
      new AppException('USER_VERSION_CONFLICT', { currentVersion: 3 }),
      { code: 'USER_VERSION_CONFLICT', details: { currentVersion: 3 } },
      false,
    ],
    [
      '業務錯誤沒有 details',
      new AppException('AUTHZ_FORBIDDEN'),
      { code: 'AUTHZ_FORBIDDEN' },
      false,
    ],
    ['非預期的錯誤', new Error('boom'), { code: 'INTERNAL_ERROR' }, true],
  ])('一列套用失敗（%s）只讓這一列失敗，繼續下一列', async (_name, error, outcomeError, logged) => {
    const create = vi
      .fn<() => Promise<ApplyResult>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ id: 'w2' });
    const { service, repo } = setup({ rows: rowsOf(2), resource: widgetResource({ create }) });
    await service.run('transfer-1', job());
    expect(outcomeOf(repo, 1)).toEqual({ outcome: 'failed', outcomeError });
    expect(create).toHaveBeenCalledTimes(2);
    expect(Logger.prototype.error).toHaveBeenCalledTimes(logged ? 1 : 0);
  });
});

describe(`DataTransferApplyService：取消與權限中途被拿掉（${SPEC} §7.6）`, () => {
  it('每 20 列查一次取消旗標；被取消時未處理的列記為 cancelled 並更新計數', async () => {
    const { service, repo, lifecycle, resource } = setup({
      transfer: transfer({ totalRows: 50 }),
      rows: rowsOf(50),
      counts: { succeeded: 20, failed: 0, skipped: 0, cancelled: 30 },
    });
    repo.findById
      .mockResolvedValueOnce(transfer())
      .mockResolvedValueOnce(transfer())
      .mockResolvedValueOnce(transfer({ status: 'cancelled' }))
      .mockResolvedValueOnce(transfer({ status: 'cancelled' }));
    await expect(service.run('transfer-1', job())).resolves.toEqual({ cancelled: true });
    expect(resource?.importer?.create).toHaveBeenCalledTimes(20);
    expect(repo.settlePending).toHaveBeenCalledExactlyOnceWith('transfer-1', 'cancelled', null);
    expect(repo.updateCounts).toHaveBeenCalledExactlyOnceWith('transfer-1', {
      processedRows: 20,
      succeededRows: 20,
      failedRows: 0,
      skippedRows: 0,
    });
    expect(lifecycle.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
      ChangeKind.UPDATE,
    );
    expect(lifecycle.record).not.toHaveBeenCalled();
  });

  it('取消後讀不到傳輸時不推播', async () => {
    const { service, repo, lifecycle } = setup({ rows: rowsOf(1) });
    repo.findById
      .mockResolvedValueOnce(transfer())
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    await expect(service.run('transfer-1', job())).resolves.toEqual({ cancelled: true });
    expect(lifecycle.publish).toHaveBeenCalledTimes(1);
  });

  it('每 100 列重新讀取權限；權限被拿掉時其餘的列以 AUTHZ_FORBIDDEN 失敗', async () => {
    const { service, repo, contexts, resource } = setup({ rows: rowsOf(201) });
    contexts.refresh.mockResolvedValueOnce(context()).mockResolvedValueOnce(context([]));
    await service.run('transfer-1', job());
    expect(contexts.refresh).toHaveBeenCalledTimes(2);
    expect(resource?.importer?.create).toHaveBeenCalledTimes(200);
    expect(repo.settlePending).toHaveBeenCalledExactlyOnceWith('transfer-1', 'failed', {
      code: 'AUTHZ_FORBIDDEN',
    });
    expect(repo.findById).toHaveBeenCalledTimes(1 + 11);
  });
});

describe(`DataTransferApplyService：交易後的副作用合併執行（${SPEC} §7.6、D10）`, () => {
  it('權限失效合併成一次、受影響者合併；推播每 100 筆一則；custom 依 key 去重；先失效再推播', async () => {
    const order: string[] = [];
    const custom = vi.fn(() => {
      order.push('custom');
    });
    let index = 0;
    const create = vi.fn(async (): Promise<ApplyResult> => {
      index += 1;
      return {
        id: `w${index}`,
        after: [
          { kind: 'permissionsChanged', userIds: [`u${index % 2}`] },
          { kind: 'resourceChanged', change: change(`w${index}`), affectedUserIds: ['a1'] },
          { kind: 'custom', key: 'rebuild', run: custom },
        ],
      };
    });
    const { service, permissions, events } = setup({
      rows: rowsOf(3),
      resource: widgetResource({ create }),
    });
    permissions.permissionsChanged.mockImplementation(async () => {
      order.push('permissions');
    });
    events.publish.mockImplementation(() => {
      order.push('publish');
    });
    // 一則推播最多 100 筆：多送幾筆 resourceChanged 驗證切分
    create.mockImplementationOnce(async () => ({
      id: 'w0',
      after: Array.from({ length: 150 }, (_, item) => ({
        kind: 'resourceChanged' as const,
        change: change(`bulk-${item}`),
      })),
    }));
    await service.run('transfer-1', job());
    expect(permissions.permissionsChanged).toHaveBeenCalledExactlyOnceWith(['u1', 'u0']);
    expect(custom).toHaveBeenCalledTimes(1);
    const published = events.publish.mock.calls as unknown as [
      string,
      { changes: unknown[]; affectedUserIds?: string[] },
    ][];
    expect(
      published.map(([event, payload]) => [event, payload.changes.length, payload.affectedUserIds]),
    ).toEqual([
      [DomainEvent.RESOURCE_CHANGED, 100, ['a1']],
      [DomainEvent.RESOURCE_CHANGED, 52, ['a1']],
    ]);
    expect(order.slice(0, 3)).toEqual(['permissions', 'custom', 'publish']);
  });

  it('有一筆權限失效沒帶受影響者時，以全租戶失效處理；沒有受影響者時推播不帶 affectedUserIds', async () => {
    const create = vi
      .fn<() => Promise<ApplyResult>>()
      .mockResolvedValueOnce({ id: 'w1', after: [{ kind: 'permissionsChanged', userIds: ['u1'] }] })
      .mockResolvedValueOnce({
        id: 'w2',
        after: [{ kind: 'permissionsChanged' }, { kind: 'resourceChanged', change: change('w2') }],
      })
      .mockResolvedValueOnce({
        id: 'w3',
        after: [{ kind: 'permissionsChanged', userIds: ['u3'] }],
      });
    const { service, permissions, events } = setup({
      rows: rowsOf(3),
      resource: widgetResource({ create }),
    });
    await service.run('transfer-1', job());
    expect(permissions.permissionsChanged).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(events.publish).toHaveBeenCalledExactlyOnceWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [change('w2')],
    });
  });

  it('每 100 列執行一次', async () => {
    const create = vi.fn(async (): Promise<ApplyResult> => ({
      id: 'w',
      after: [{ kind: 'permissionsChanged' }],
    }));
    const { service, permissions } = setup({
      rows: rowsOf(150),
      resource: widgetResource({ create }),
    });
    await service.run('transfer-1', job());
    expect(permissions.permissionsChanged).toHaveBeenCalledTimes(2);
  });

  it(`距離上次執行超過 ${DATA_TRANSFER_EFFECT_FLUSH_INTERVAL_MS}ms 時不等滿 100 列`, async () => {
    const create = vi.fn(async (): Promise<ApplyResult> => {
      advance(DATA_TRANSFER_EFFECT_FLUSH_INTERVAL_MS);
      return { id: 'w', after: [{ kind: 'permissionsChanged' }] };
    });
    const { service, permissions } = setup({
      rows: rowsOf(3),
      resource: widgetResource({ create }),
    });
    await service.run('transfer-1', job());
    expect(permissions.permissionsChanged).toHaveBeenCalledTimes(3);
  });
});

describe(`DataTransferApplyService：進度與完成（${SPEC} §7.6、§9.6）`, () => {
  it('每 500 列回報進度並推播', async () => {
    const { service, repo, lifecycle } = setup({
      transfer: transfer({ totalRows: 500 }),
      rows: rowsOf(500),
      counts: { pending: 0, succeeded: 500 },
    });
    await service.run('transfer-1', job());
    expect(repo.updateProgress).toHaveBeenCalledExactlyOnceWith('transfer-1', 'applying', {
      processedRows: 500,
      succeededRows: 500,
      failedRows: 0,
      skippedRows: 0,
    });
    // applying、進度、完成
    expect(lifecycle.publish).toHaveBeenCalledTimes(3);
  });

  it('距離上次回報超過間隔時也回報；更新不到時不推播', async () => {
    const create = vi.fn(async (): Promise<ApplyResult> => {
      advance(DATA_TRANSFER_PROGRESS_INTERVAL_MS);
      return { id: 'w' };
    });
    const { service, repo, lifecycle } = setup({
      transfer: transfer({ totalRows: 2 }),
      rows: rowsOf(2),
      resource: widgetResource({ create }),
      counts: { pending: 1, succeeded: 1 },
    });
    repo.updateProgress.mockResolvedValue(undefined);
    await service.run('transfer-1', job());
    expect(repo.updateProgress).toHaveBeenCalledTimes(2);
    expect(repo.updateProgress).toHaveBeenNthCalledWith(
      1,
      'transfer-1',
      'applying',
      expect.objectContaining({ processedRows: 1 }),
    );
    // applying、完成
    expect(lifecycle.publish).toHaveBeenCalledTimes(2);
  });

  it('完成：在一個交易內轉成 completed、寫稽核與通知，記指標並推播', async () => {
    const inc = vi.spyOn(dataTransferRows, 'inc');
    const { service, repo, tx, lifecycle } = setup({
      transfer: transfer({ totalRows: 6 }),
      rows: rowsOf(1),
      counts: { succeeded: 3, failed: 1, skipped: 0, cancelled: 2 },
    });
    await expect(service.run('transfer-1', job())).resolves.toEqual({
      succeeded: 3,
      failed: 1,
      skipped: 0,
    });
    expect(repo.transition).toHaveBeenLastCalledWith(
      'transfer-1',
      ['applying'],
      {
        status: 'completed',
        processedRows: 6,
        succeededRows: 3,
        failedRows: 3,
        skippedRows: 0,
        finishedAt: new Date(now),
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
      { tx },
    );
    expect(lifecycle.record).toHaveBeenCalledExactlyOnceWith(
      'dataTransfer.import',
      expect.objectContaining({ status: 'completed' }),
      {
        type: 'widget',
        mode: 'create',
        total: 6,
        succeeded: 3,
        failed: 3,
        skipped: 0,
        fileName: 'widgets.csv',
      },
      tx,
    );
    expect(lifecycle.notifyFinished).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: 'completed' }),
      tx,
    );
    expect(inc).toHaveBeenCalledTimes(2);
    expect(inc).toHaveBeenCalledWith(
      { direction: 'import', type: 'widget', result: 'succeeded' },
      3,
    );
    expect(inc).toHaveBeenCalledWith({ direction: 'import', type: 'widget', result: 'failed' }, 1);
    expect(lifecycle.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'completed' }),
      ChangeKind.UPDATE,
    );
  });

  it('完成前已被取消（轉移失敗）時回報取消，不寫稽核', async () => {
    const { service, repo, lifecycle } = setup({ rows: rowsOf(1) });
    repo.transition.mockImplementation(async (_id, from, values) =>
      from.includes('queued') ? ({ ...transfer(), ...values } as DataTransferRow) : undefined,
    );
    await expect(service.run('transfer-1', job())).resolves.toEqual({ cancelled: true });
    expect(lifecycle.record).not.toHaveBeenCalled();
    expect(lifecycle.notifyFinished).not.toHaveBeenCalled();
  });
});

describe(`DataTransferApplyService：同一份檔案內的引用（${SPEC} §7.8）`, () => {
  const COLUMNS = [CODE, PARENT];

  it('被引用的列先套用，引用它的列換成建立出來的 id', async () => {
    const create = vi.fn(
      async (values: Readonly<Record<string, unknown>>): Promise<ApplyResult> => ({
        id: `id-${String(values.code)}`,
      }),
    );
    const { service } = setup({
      rows: [
        applyRow(1, { raw: { code: 'child', parent: 'top' } }),
        applyRow(2, { raw: { code: 'Top' } }),
      ],
      results: [
        validated(1, {
          values: { code: 'child', parent: sameFileRef('top') },
          texts: { parent: 'top' },
        }),
        validated(2, { values: { code: 'Top' } }),
      ],
      resource: widgetResource({ create }, COLUMNS),
    });
    await service.run('transfer-1', job());
    expect(create.mock.calls.map(([values]) => values)).toEqual([
      { code: 'Top' },
      { code: 'child', parent: 'id-Top' },
    ]);
  });

  it('被引用的列沒有成功時以 referenceFailed 失敗', async () => {
    const create = vi
      .fn<() => Promise<ApplyResult>>()
      .mockRejectedValueOnce(new AppException('VALIDATION_FAILED'));
    const { service, repo } = setup({
      rows: [
        applyRow(1, { raw: { code: 'child', parent: 'top' } }),
        applyRow(2, { raw: { code: 'top' } }),
        applyRow(3, { raw: { code: 'other', parent: 'top' } }),
      ],
      results: [
        validated(1, {
          values: { code: 'child', parent: sameFileRef('top') },
          texts: { parent: 'Top!' },
        }),
        validated(2, { values: { code: 'top' } }),
        validated(3, { values: { code: 'other', parent: sameFileRef('top') }, texts: {} }),
      ],
      resource: widgetResource({ create }, COLUMNS),
    });
    await service.run('transfer-1', job());
    expect(outcomeOf(repo, 1)).toEqual(referenceFailed('parent', 'Top!'));
    expect(outcomeOf(repo, 3)).toEqual(referenceFailed('parent', 'top'));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('在引用循環裡的列直接以 referenceCycle 失敗', async () => {
    const { service, repo, resource } = setup({
      rows: [
        applyRow(1, { raw: { code: 'a', parent: 'b' } }),
        applyRow(2, { raw: { code: 'b', parent: 'a' } }),
      ],
      results: [
        validated(1, { values: { code: 'a', parent: sameFileRef('b') } }),
        validated(2, { values: { code: 'b', parent: sameFileRef('a') } }),
      ],
      resource: widgetResource({}, COLUMNS),
    });
    await service.run('transfer-1', job());
    for (const rowNo of [1, 2]) {
      expect(outcomeOf(repo, rowNo)).toEqual({
        outcome: 'failed',
        outcomeError: {
          code: 'VALIDATION_FAILED',
          issues: [{ column: null, code: 'referenceCycle', severity: 'error' }],
        },
      });
    }
    expect(resource?.importer?.create).not.toHaveBeenCalled();
  });

  it('被引用欄沒有填的列不登記可被引用的值', async () => {
    const create = vi.fn(async (): Promise<ApplyResult> => ({ id: 'x' }));
    const { service } = setup({
      rows: [applyRow(1, { raw: { parent: '' } })],
      results: [validated(1, { values: {} })],
      resource: widgetResource({ create }, [
        CODE,
        { ...PARENT, reference: { ...PARENT.reference!, sameFile: { column: 'missing' } } },
      ]),
    });
    await service.run('transfer-1', job());
    expect(create).toHaveBeenCalledTimes(1);
  });
});
