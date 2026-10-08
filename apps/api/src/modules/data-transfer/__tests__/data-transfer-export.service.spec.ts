import { ChangeKind } from '@b2b-system/realtime';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppException } from '@/core/errors';
import type { JobContext } from '@/core/jobs';
import type { ObjectStorage } from '@/core/storage';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';
import type { DataTransferRow } from '@/db/schema';

import { DataTransferRegistry } from '../data-transfer-registry.service';
import { TransferOwnerUnavailableError } from '../data-transfer.context';
import type { DataTransferContextFactory } from '../data-transfer.context';
import type { DataTransferLifecycle } from '../data-transfer.lifecycle';
import type { DataTransferRepository } from '../data-transfer.repository';
import type { AnyTransferResource, TransferColumn, TransferContext } from '../data-transfer.types';
import { DataTransferExportService, exportFileName } from '../export/data-transfer-export.service';
import { createExportWriter, EXPORT_CONTENT_TYPE } from '../export/export-writers';
import { transferContext, transferRow, widgetResource } from './data-transfer.fixture';

/** 寫檔器與分段上傳以假物件代替（各自的行為在 export-writers.spec.ts、multipart-sink.spec.ts）。 */
const fakes = vi.hoisted(() => ({
  sink: null as unknown as {
    flush: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  },
  sinkArgs: [] as unknown[][],
}));

vi.mock('../export/export-writers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../export/export-writers')>()),
  createExportWriter: vi.fn(),
}));

vi.mock('../export/multipart-sink', () => ({
  MultipartSink: class {
    constructor(...args: unknown[]) {
      fakes.sinkArgs.push(args);
      // oxlint-disable-next-line no-constructor-return -- 測試替身：回傳共用的假物件
      return fakes.sink;
    }
  },
}));

const MAX_ROWS = 2000;
const NOW = new Date('2026-10-08T06:30:00.000Z');
const EXPIRES = new Date('2026-10-15T06:30:00.000Z');

function records(count: number): { name: string }[] {
  return Array.from({ length: count }, (_, index) => ({ name: `w-${index}` }));
}

/** 過了一秒才產生的一頁。 */
function later(count: number) {
  return () => {
    vi.setSystemTime(Date.now() + 1000);
    return records(count);
  };
}

function inTenant<T>(fn: () => T): T {
  return runInTenantContext(
    {
      features: [],
      featureParams: { 'dataTransfer.exportMaxRows': MAX_ROWS },
    } as unknown as TenantContext,
    fn,
  );
}

interface SetupOptions {
  stored?: DataTransferRow;
  ctx?: TransferContext;
  resource?: AnyTransferResource;
  /** 每一頁；函式會在產生那一頁之前呼叫（推進時間、中止）。 */
  pages?: readonly (readonly unknown[] | (() => readonly unknown[]))[];
  estimated?: number;
}

function setup(options: SetupOptions = {}) {
  const stored =
    options.stored ??
    transferRow({
      status: 'queued',
      params: { scope: { kind: 'filter', filter: { q: 'a' } }, columns: ['name', 'secret'] },
    });
  const tx = { name: 'tx' };
  const db = { transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    findById: vi.fn(async (): Promise<DataTransferRow | undefined> => stored),
    transition: vi.fn(
      async (
        _id: string,
        _from: readonly string[],
        values: Partial<DataTransferRow>,
      ): Promise<DataTransferRow | undefined> => transferRow({ ...stored, ...values }),
    ),
    updateProgress: vi.fn(
      async (_id: string, _status: string, values: Partial<DataTransferRow>) =>
        transferRow({ ...stored, status: 'running', ...values }) as DataTransferRow | undefined,
    ),
  };
  const pages = options.pages ?? [records(2), records(1)];
  const base = options.resource ?? widgetResource();
  const resource: AnyTransferResource = base.exporter
    ? {
        ...base,
        exporter: {
          ...base.exporter,
          count: vi.fn(async () => options.estimated ?? 3),
          iterate: async function* () {
            for (const page of pages) yield typeof page === 'function' ? page() : page;
          },
        },
      }
    : base;
  const registry = new DataTransferRegistry();
  registry.register(resource);
  const ctx = options.ctx ?? transferContext(['widget:export', 'widget:secret']);
  const contexts = {
    forJob: vi.fn(async () => ctx),
    runAs: vi.fn((_ctx: TransferContext, _jobId: string, fn: () => Promise<unknown>) => fn()),
    assertHasAll: vi.fn(async () => undefined),
  };
  const lifecycle = {
    publish: vi.fn(),
    fail: vi.fn(async () => undefined),
    expiresAt: vi.fn(async () => EXPIRES),
    record: vi.fn(async () => undefined),
    notifyFinished: vi.fn(async () => undefined),
  };
  const storage = { delete: vi.fn(async () => undefined) };
  const writer = {
    start: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
    finish: vi.fn(async () => ({ truncatedCells: 0 })),
  };
  vi.mocked(createExportWriter).mockReturnValue(writer);
  fakes.sink = {
    flush: vi.fn(async () => undefined),
    complete: vi.fn(async () => 1234),
    abort: vi.fn(async () => undefined),
  };
  fakes.sinkArgs = [];
  const abort = new AbortController();
  const job: JobContext = { id: 'job-1', retryCount: 0, signal: abort.signal };
  const service = new DataTransferExportService(
    db as never,
    repo as unknown as DataTransferRepository,
    registry,
    contexts as unknown as DataTransferContextFactory,
    lifecycle as unknown as DataTransferLifecycle,
    storage as unknown as ObjectStorage,
  );
  const run = (context: JobContext = job) => inTenant(() => service.run('transfer-1', context));
  return {
    service,
    run,
    tx,
    repo,
    contexts,
    lifecycle,
    storage,
    writer,
    sink: fakes.sink,
    job,
    abort,
    ctx,
  };
}

describe('exportFileName（docs/architecture/backend/22-data-transfer.md §6.5）', () => {
  it.each([
    [false, 'widgets-20261008-1430.csv'],
    [true, 'widgets-20261008-1430-selection.csv'],
  ])('勾選範圍 %s → %s（匯出者時區）', (selection, expected) => {
    expect(exportFileName({ fileBaseName: 'widgets' }, 'csv', NOW, 'Asia/Taipei', selection)).toBe(
      expected,
    );
  });
});

describe('DataTransferExportService（docs/architecture/backend/22-data-transfer.md §6.3）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('開始前的檢查', () => {
    it('傳輸已不存在：略過', async () => {
      const { run, repo } = setup();
      repo.findById.mockResolvedValueOnce(undefined);
      await expect(run()).resolves.toEqual({ skipped: 'notFound' });
      expect(repo.transition).not.toHaveBeenCalled();
    });

    it('已不是 queued／running（例：被取消）：略過並回報目前狀態', async () => {
      const { run, repo, lifecycle } = setup({ stored: transferRow({ status: 'cancelled' }) });
      repo.transition.mockResolvedValueOnce(undefined);
      await expect(run()).resolves.toEqual({ skipped: 'cancelled' });
      expect(lifecycle.publish).not.toHaveBeenCalled();
    });

    it('queued → running：記下開始時間、歸零進度並推播', async () => {
      const { run, repo, lifecycle } = setup();
      await run();
      expect(repo.transition).toHaveBeenNthCalledWith(1, 'transfer-1', ['queued', 'running'], {
        status: 'running',
        startedAt: NOW,
        processedRows: 0,
      });
      expect(lifecycle.publish).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ status: 'running' }),
        ChangeKind.UPDATE,
      );
    });

    it('重試時已經是 running：保留原本的開始時間', async () => {
      const startedAt = new Date('2026-10-08T06:00:00.000Z');
      const { run, repo } = setup({
        stored: transferRow({
          status: 'running',
          startedAt,
          params: { scope: { kind: 'filter', filter: {} }, columns: ['name'] },
        }),
      });
      await run();
      expect(repo.transition).toHaveBeenNthCalledWith(
        1,
        'transfer-1',
        ['queued', 'running'],
        expect.objectContaining({ startedAt }),
      );
    });

    it.each([
      ['資源類型已不存在', 'gadget'],
      ['資源已不能匯出', 'widget'],
    ])('%s：failed ＋ DATA_TRANSFER_TYPE_UNSUPPORTED', async (_name, type) => {
      const { run, lifecycle } = setup({ resource: widgetResource({ type, exporter: undefined }) });
      await expect(run()).resolves.toEqual({ failed: 'DATA_TRANSFER_TYPE_UNSUPPORTED' });
      expect(lifecycle.fail).toHaveBeenCalledWith('transfer-1', 'DATA_TRANSFER_TYPE_UNSUPPORTED', {
        type: 'widget',
      });
    });

    it('建立者已停用或刪除：failed ＋ AUTHZ_FORBIDDEN（ownerUnavailable）', async () => {
      const { run, contexts, lifecycle, writer } = setup();
      contexts.forJob.mockRejectedValueOnce(new TransferOwnerUnavailableError());
      await expect(run()).resolves.toEqual({ failed: 'AUTHZ_FORBIDDEN' });
      expect(lifecycle.fail).toHaveBeenCalledWith('transfer-1', 'AUTHZ_FORBIDDEN', {
        reason: 'ownerUnavailable',
      });
      expect(writer.start).not.toHaveBeenCalled();
    });

    it('重建脈絡的其他錯誤往外拋，交給重試', async () => {
      const { run, contexts, lifecycle } = setup();
      contexts.forJob.mockRejectedValueOnce(new Error('db down'));
      await expect(run()).rejects.toThrow('db down');
      expect(lifecycle.fail).not.toHaveBeenCalled();
    });

    it('建立後被拿掉匯出權限：failed ＋ 權限錯誤碼與 details（§6.3 步驟 2）', async () => {
      const { run, contexts, lifecycle, writer } = setup();
      contexts.assertHasAll.mockRejectedValueOnce(
        new AppException('AUTHZ_FORBIDDEN', { missing: ['widget:export'] }),
      );
      await expect(run()).resolves.toEqual({ failed: 'AUTHZ_FORBIDDEN' });
      expect(contexts.assertHasAll).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-1' }),
        ['widget:export'],
        'job dataTransfer.export',
      );
      expect(lifecycle.fail).toHaveBeenCalledWith('transfer-1', 'AUTHZ_FORBIDDEN', {
        missing: ['widget:export'],
      });
      expect(writer.start).not.toHaveBeenCalled();
    });

    it('權限錯誤沒有 details 時記 null', async () => {
      const { run, contexts, lifecycle } = setup();
      contexts.assertHasAll.mockRejectedValueOnce(new AppException('AUTHZ_FORBIDDEN'));
      await run();
      expect(lifecycle.fail).toHaveBeenCalledWith('transfer-1', 'AUTHZ_FORBIDDEN', null);
    });

    it('權限檢查的非預期錯誤往外拋', async () => {
      const { run, contexts, lifecycle } = setup();
      contexts.assertHasAll.mockRejectedValueOnce(new Error('cache down'));
      await expect(run()).rejects.toThrow('cache down');
      expect(lifecycle.fail).not.toHaveBeenCalled();
    });

    it('預估筆數超過租戶上限：failed ＋ DATA_TRANSFER_TOO_MANY_ROWS', async () => {
      const { run, lifecycle, writer } = setup({ estimated: MAX_ROWS + 1 });
      await expect(run()).resolves.toEqual({ failed: 'DATA_TRANSFER_TOO_MANY_ROWS' });
      expect(lifecycle.fail).toHaveBeenCalledWith('transfer-1', 'DATA_TRANSFER_TOO_MANY_ROWS', {
        max: MAX_ROWS,
        count: MAX_ROWS + 1,
      });
      expect(writer.start).not.toHaveBeenCalled();
    });
  });

  describe('寫檔與完成', () => {
    it('以建立者的身分執行，逐頁寫檔、每頁 flush；完成時在交易內記下產出、寫稽核、通知', async () => {
      const { run, contexts, repo, lifecycle, writer, sink, tx, ctx } = setup();
      await expect(run()).resolves.toEqual({ rows: 3, bytes: 1234 });

      expect(contexts.runAs).toHaveBeenCalledWith(ctx, 'job-1', expect.any(Function));
      expect(fakes.sinkArgs[0]).toEqual([
        expect.anything(),
        'transfers/transfer-1/widgets-20261008-1430.csv',
        EXPORT_CONTENT_TYPE.csv,
        8 * 1024 * 1024,
      ]);
      expect(writer.start).toHaveBeenCalledTimes(1);
      expect(writer.write).toHaveBeenCalledTimes(2);
      expect(sink.flush).toHaveBeenCalledTimes(2);
      expect(writer.finish).toHaveBeenCalledWith(3);
      expect(sink.abort).not.toHaveBeenCalled();
      expect(repo.updateProgress).not.toHaveBeenCalled();

      expect(repo.transition).toHaveBeenLastCalledWith(
        'transfer-1',
        ['running'],
        {
          status: 'completed',
          outputKey: 'transfers/transfer-1/widgets-20261008-1430.csv',
          outputName: 'widgets-20261008-1430.csv',
          outputSize: 1234,
          totalRows: 3,
          processedRows: 3,
          finishedAt: NOW,
          expiresAt: EXPIRES,
          errorDetails: null,
        },
        { tx },
      );
      expect(lifecycle.record).toHaveBeenCalledWith(
        'dataTransfer.export',
        expect.objectContaining({ status: 'completed' }),
        {
          type: 'widget',
          format: 'csv',
          scope: 'filter',
          filter: { q: 'a' },
          rows: 3,
          columns: ['name', 'secret'],
        },
        tx,
      );
      expect(lifecycle.notifyFinished).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
        tx,
      );
      expect(lifecycle.publish).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'completed' }),
        ChangeKind.UPDATE,
      );
    });

    it('寫檔器拿到的是建立者當下有權讀、且建立時選的欄位；標籤用建立者的語系', async () => {
      const extra: TransferColumn<unknown> = {
        key: 'note',
        label: { 'zh-TW': '備註', 'en-US': 'Note' },
        kind: 'string',
        export: { get: () => '' },
      };
      const base = widgetResource();
      const { run } = setup({
        resource: { ...base, columns: [...base.columns, extra] },
        ctx: transferContext(['widget:export'], { locale: 'en-US' }),
      });
      await run();
      const [format, columns, , , meta] = vi.mocked(createExportWriter).mock.calls.at(-1)!;
      expect(format).toBe('csv');
      expect(columns.map((column) => column.key)).toEqual(['name']);
      expect(meta).toEqual({
        fileBaseName: 'widgets',
        label: 'Widgets',
        generatedAt: NOW,
        generatedBy: 'owner@example.com',
      });
    });

    it('勾選範圍：檔名加 -selection，稽核記下勾選數', async () => {
      const { run, lifecycle } = setup({
        stored: transferRow({
          format: 'xlsx',
          params: { scope: { kind: 'ids', ids: ['a', 'b'] }, columns: ['name'] },
        }),
      });
      await run();
      expect(fakes.sinkArgs[0]?.[1]).toBe(
        'transfers/transfer-1/widgets-20261008-1430-selection.xlsx',
      );
      expect(fakes.sinkArgs[0]?.[2]).toBe(EXPORT_CONTENT_TYPE.xlsx);
      expect(lifecycle.record).toHaveBeenCalledWith(
        'dataTransfer.export',
        expect.anything(),
        expect.objectContaining({ scope: 'ids', selected: 2, format: 'xlsx' }),
        expect.anything(),
      );
    });

    it('XLSX 有被截斷的儲存格時記在 errorDetails', async () => {
      const { run, repo, writer } = setup();
      writer.finish.mockResolvedValueOnce({ truncatedCells: 4 });
      await run();
      expect(repo.transition).toHaveBeenLastCalledWith(
        'transfer-1',
        ['running'],
        expect.objectContaining({ errorDetails: { truncatedCells: 4 } }),
        expect.anything(),
      );
    });

    it('寫檔期間被取消（完成的轉移落空）：刪掉產出，回報 cancelled', async () => {
      const { run, repo, storage, lifecycle } = setup();
      repo.transition
        .mockImplementationOnce(async (_id, _from, values) => transferRow({ ...values }))
        .mockResolvedValueOnce(undefined);
      await expect(run()).resolves.toEqual({ cancelled: true, rows: 3 });
      expect(storage.delete).toHaveBeenCalledWith('transfers/transfer-1/widgets-20261008-1430.csv');
      expect(lifecycle.record).not.toHaveBeenCalled();
      expect(lifecycle.notifyFinished).not.toHaveBeenCalled();
    });

    it('實際列數超過上限：放棄已上傳的段，failed ＋ DATA_TRANSFER_TOO_MANY_ROWS', async () => {
      const { run, sink, lifecycle, writer } = setup({
        pages: [records(1200), records(1200)],
      });
      await expect(run()).resolves.toEqual({ failed: 'DATA_TRANSFER_TOO_MANY_ROWS' });
      expect(sink.abort).toHaveBeenCalledTimes(1);
      expect(writer.write).toHaveBeenCalledTimes(1);
      expect(lifecycle.fail).toHaveBeenCalledWith('transfer-1', 'DATA_TRANSFER_TOO_MANY_ROWS', {
        max: MAX_ROWS,
        count: 2400,
      });
    });
  });

  describe('進度與取消（§6.3 步驟 5）', () => {
    it('每 500 列且每秒更新一次進度並推播', async () => {
      const { run, repo, lifecycle } = setup({
        pages: [later(500), records(100), later(100), later(400)],
      });
      await expect(run()).resolves.toMatchObject({ rows: 1100 });
      // 第一頁：滿 500 列且過了 1 秒；第二、三頁不到 500 列；第四頁累積 600 列
      expect(repo.updateProgress).toHaveBeenCalledTimes(2);
      expect(repo.updateProgress).toHaveBeenNthCalledWith(1, 'transfer-1', 'running', {
        processedRows: 500,
      });
      expect(repo.updateProgress).toHaveBeenNthCalledWith(2, 'transfer-1', 'running', {
        processedRows: 1100,
      });
      expect(
        lifecycle.publish.mock.calls.filter(
          ([row]) => (row as DataTransferRow).processedRows === 500,
        ),
      ).toHaveLength(1);
    });

    it('滿 500 列但不到一秒時不更新', async () => {
      const { run, repo } = setup({ pages: [records(500), records(500)] });
      await run();
      expect(repo.updateProgress).not.toHaveBeenCalled();
    });

    it('檢查點發現已被取消：放棄已上傳的段，回報 cancelled，不標 failed', async () => {
      const { run, repo, sink, lifecycle, storage } = setup({ pages: [later(500), records(1)] });
      repo.updateProgress.mockResolvedValueOnce(transferRow({ status: 'cancelled' }));
      await expect(run()).resolves.toEqual({ cancelled: true, rows: 500 });
      expect(sink.abort).toHaveBeenCalledTimes(1);
      expect(lifecycle.fail).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('檢查點發現傳輸已被刪除：同樣視為取消', async () => {
      const { run, repo } = setup({ pages: [later(500)] });
      repo.updateProgress.mockResolvedValueOnce(undefined);
      await expect(run()).resolves.toEqual({ cancelled: true, rows: 500 });
    });

    it('放棄分段上傳失敗時只記警告，照樣回報 cancelled', async () => {
      const { run, repo, sink } = setup({ pages: [later(500)] });
      repo.updateProgress.mockResolvedValueOnce(transferRow({ status: 'cancelled' }));
      sink.abort.mockRejectedValueOnce(new Error('s3 down'));
      await expect(run()).resolves.toEqual({ cancelled: true, rows: 500 });
      expect(Logger.prototype.warn).toHaveBeenCalledWith(
        expect.objectContaining({ transferId: 'transfer-1' }),
        '放棄匯出檔的分段上傳失敗',
      );
    });
  });

  describe('失敗與重試', () => {
    it('工作被中止（關機或逾時）：放棄分段、往外拋交給重試，還有重試次數時不標 failed', async () => {
      const { run, abort, sink, lifecycle } = setup({
        pages: [
          () => {
            abort.abort();
            return records(1);
          },
        ],
      });
      await expect(run()).rejects.toThrow('匯出工作被中止');
      expect(sink.abort).toHaveBeenCalledTimes(1);
      expect(lifecycle.fail).not.toHaveBeenCalled();
    });

    it('重試用盡：failed ＋ INTERNAL_ERROR，仍往外拋', async () => {
      const { run, job, sink, lifecycle } = setup();
      sink.complete.mockRejectedValueOnce(new Error('s3 down'));
      await expect(run({ ...job, retryCount: 2 })).rejects.toThrow('s3 down');
      expect(lifecycle.fail).toHaveBeenCalledWith('transfer-1', 'INTERNAL_ERROR');
    });

    it('重試用盡且錯誤是 AppException：以它的錯誤碼標 failed', async () => {
      const { run, job, writer, lifecycle } = setup();
      writer.write.mockRejectedValueOnce(new AppException('VALIDATION_FAILED'));
      await expect(run({ ...job, retryCount: 2 })).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(lifecycle.fail).toHaveBeenCalledWith('transfer-1', 'VALIDATION_FAILED');
    });
  });
});
