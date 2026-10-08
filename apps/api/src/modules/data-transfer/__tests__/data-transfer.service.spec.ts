import { ChangeKind } from '@b2b-system/realtime';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { AuthUser, PermissionKey } from '@/common/types';
import { AppException } from '@/core/errors';
import type { JobQueue } from '@/core/jobs';
import type { ObjectStorage } from '@/core/storage';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';
import type { DataTransferRow } from '@/db/schema';

import { DataTransferRegistry } from '../data-transfer-registry.service';
import type { DataTransferContextFactory } from '../data-transfer.context';
import { DATA_TRANSFER_EXPORT_JOB } from '../data-transfer.job-types';
import type { DataTransferLifecycle } from '../data-transfer.lifecycle';
import type { DataTransferRepository } from '../data-transfer.repository';
import { DataTransferService } from '../data-transfer.service';
import type { AnyTransferResource, TransferContext } from '../data-transfer.types';
import type { CreateExportDto } from '../dto/data-transfer.dto';
import { transferContext, transferRow, widgetResource } from './data-transfer.fixture';

const OWNER: AuthUser = { id: 'user-1', email: 'owner@example.com', status: 'active' };
const OTHER: AuthUser = { id: 'user-2', email: 'other@example.com', status: 'active' };
const PREFERENCE = { locale: 'zh-TW', timezone: 'Asia/Taipei' };
const MAX_ROWS = 2000;
const EXPIRES = new Date('2026-10-15T00:00:00.000Z');

/** 以真的 zod schema 驗證 id 與篩選條件的資源。 */
function exportable(overrides: Partial<AnyTransferResource> = {}): AnyTransferResource {
  const base = widgetResource();
  return {
    ...base,
    exporter: {
      ...base.exporter!,
      idSchema: z.string().regex(/^w-\d+$/),
      filterSchema: z.object({ keyword: z.string().max(5).optional() }),
      orderHint: { 'zh-TW': '依名稱', 'en-US': 'By name' },
      count: vi.fn(async () => 10),
    },
    ...overrides,
  };
}

function inTenant<T>(fn: () => T, features: readonly string[] = []): T {
  return runInTenantContext(
    {
      features,
      featureParams: { 'dataTransfer.exportMaxRows': MAX_ROWS },
    } as unknown as TenantContext,
    fn,
  );
}

function setup(
  options: {
    stored?: DataTransferRow;
    ctx?: TransferContext;
    resources?: AnyTransferResource[];
  } = {},
) {
  const tx = { name: 'tx' };
  const db = { transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    listByCreator: vi.fn(async () => ({ items: [transferRow()], total: 1 })),
    findById: vi.fn(
      async (): Promise<DataTransferRow | undefined> => options.stored ?? transferRow(),
    ),
    transition: vi.fn(
      async (
        _id: string,
        _from: readonly string[],
        values: Partial<DataTransferRow>,
      ): Promise<DataTransferRow | undefined> => transferRow({ ...options.stored, ...values }),
    ),
    settlePending: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    countActive: vi.fn(async () => 0),
    create: vi.fn(async (values: Partial<DataTransferRow>) =>
      transferRow({ ...values, id: 'transfer-new' }),
    ),
    listRows: vi.fn(async () => [] as Record<string, unknown>[]),
  };
  const registry = new DataTransferRegistry();
  for (const resource of options.resources ?? [exportable()]) registry.register(resource);
  const contexts = {
    forRequest: vi.fn(
      async () => options.ctx ?? transferContext(['widget:export', 'widget:secret']),
    ),
    assertHasAll: vi.fn(async () => undefined),
  };
  const lifecycle = {
    expiresAt: vi.fn(async () => EXPIRES),
    pendingExpiresAt: vi.fn(() => EXPIRES),
    publish: vi.fn(),
    record: vi.fn(async () => undefined),
  };
  const jobs = { enqueue: vi.fn(async () => 'job-1') };
  const storage = {
    delete: vi.fn(async () => undefined),
    presignDownload: vi.fn(async () => ({
      url: 'https://files.example.com/signed',
      expiresAt: new Date('2026-10-08T07:00:00.000Z'),
    })),
  };
  const config = { get: vi.fn(() => 300) };
  const service = new DataTransferService(
    db as never,
    repo as unknown as DataTransferRepository,
    registry,
    contexts as unknown as DataTransferContextFactory,
    lifecycle as unknown as DataTransferLifecycle,
    jobs as unknown as JobQueue,
    storage as unknown as ObjectStorage,
    config as unknown as ConfigService<never, true>,
  );
  return { service, tx, repo, registry, contexts, lifecycle, jobs, storage, config };
}

function applyRow(rowNo: number, overrides: Record<string, unknown> = {}) {
  return {
    rowNo,
    sourceRow: rowNo + 1,
    raw: { name: `w-${rowNo}` },
    outcome: 'succeeded',
    outcomeError: null,
    changes: null,
    resultId: `id-${rowNo}`,
    ...overrides,
  };
}

function exportDto(overrides: Partial<CreateExportDto> = {}): CreateExportDto {
  return { type: 'widget', format: 'csv', scope: { kind: 'filter', filter: {} }, ...overrides };
}

describe('DataTransferService（docs/architecture/backend/22-data-transfer.md §4.2）', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('list：只列自己建立的，分頁包成 { items, pagination }', async () => {
    const { service, repo } = setup();
    const query = { offset: 0, limit: 20 } as never;
    const result = await service.list(query, OWNER);
    expect(repo.listByCreator).toHaveBeenCalledWith('user-1', query);
    expect(result.pagination).toEqual({ offset: 0, limit: 20, total: 1 });
    expect(result.items[0]?.id).toBe('transfer-1');
  });

  describe('getOwned／findOne：別人的與不存在的一律 404', () => {
    it('自己建立的回傳 DTO', async () => {
      const { service } = setup();
      await expect(service.findOne('transfer-1', OWNER)).resolves.toMatchObject({
        id: 'transfer-1',
      });
    });

    it('別人建立的拋 DATA_TRANSFER_NOT_FOUND', async () => {
      const { service } = setup();
      await expect(service.findOne('transfer-1', OTHER)).rejects.toMatchObject({
        code: 'DATA_TRANSFER_NOT_FOUND',
      });
    });

    it('不存在的拋 DATA_TRANSFER_NOT_FOUND', async () => {
      const { service, repo } = setup();
      repo.findById.mockResolvedValueOnce(undefined);
      await expect(service.getOwned('missing', OWNER)).rejects.toMatchObject({
        code: 'DATA_TRANSFER_NOT_FOUND',
      });
    });
  });

  describe('cancel（§6.4）', () => {
    it('匯出 running → cancelled：以 version 樂觀鎖、寫稽核、推播；不動套用列', async () => {
      const stored = transferRow({ status: 'running', version: 3 });
      const { service, repo, lifecycle, tx } = setup({ stored });
      const dto = await service.cancel('transfer-1', { version: 3 }, OWNER);

      expect(dto.status).toBe('cancelled');
      expect(repo.transition).toHaveBeenCalledWith(
        'transfer-1',
        ['queued', 'running'],
        expect.objectContaining({ status: 'cancelled', expiresAt: EXPIRES }),
        { expectedVersion: 3, tx },
      );
      expect(lifecycle.record).toHaveBeenCalledWith(
        'dataTransfer.cancel',
        expect.objectContaining({ status: 'cancelled' }),
        { direction: 'export', type: 'widget', status: 'running' },
        tx,
      );
      expect(repo.settlePending).not.toHaveBeenCalled();
      expect(lifecycle.publish).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'transfer-1' }),
        ChangeKind.UPDATE,
      );
    });

    it('還沒開始的匯入：套用列直接標成取消', async () => {
      const stored = transferRow({ direction: 'import', status: 'queued' });
      const { service, repo } = setup({ stored });
      await service.cancel('transfer-1', { version: 1 }, OWNER);
      expect(repo.transition).toHaveBeenCalledWith(
        'transfer-1',
        ['queued', 'applying'],
        expect.anything(),
        expect.anything(),
      );
      expect(repo.settlePending).toHaveBeenCalledWith('transfer-1', 'cancelled', null);
    });

    it('套用中的匯入：交給工作在下一個檢查點處理，不直接標套用列', async () => {
      const stored = transferRow({ direction: 'import', status: 'applying' });
      const { service, repo } = setup({ stored });
      await service.cancel('transfer-1', { version: 1 }, OWNER);
      expect(repo.settlePending).not.toHaveBeenCalled();
    });

    it.each([
      ['已完成的匯出', transferRow({ status: 'completed' })],
      ['驗證中的匯入（running 不能取消）', transferRow({ direction: 'import', status: 'running' })],
      ['未知的方向', transferRow({ direction: 'sync', status: 'queued' })],
    ])('%s：拋 DATA_TRANSFER_INVALID_STATE', async (_name, stored) => {
      const { service, repo } = setup({ stored });
      await expect(service.cancel('transfer-1', { version: 1 }, OWNER)).rejects.toMatchObject({
        code: 'DATA_TRANSFER_INVALID_STATE',
        details: { status: stored.status },
      });
      expect(repo.transition).not.toHaveBeenCalled();
    });

    it('version 不符時拋 DATA_TRANSFER_VERSION_CONFLICT 並帶目前的版本', async () => {
      const stored = transferRow({ status: 'queued', version: 1 });
      const { service, repo, lifecycle } = setup({ stored });
      repo.transition.mockResolvedValueOnce(undefined);
      repo.findById
        .mockResolvedValueOnce(stored)
        .mockResolvedValueOnce(transferRow({ status: 'queued', version: 2 }));
      await expect(service.cancel('transfer-1', { version: 1 }, OWNER)).rejects.toMatchObject({
        code: 'DATA_TRANSFER_VERSION_CONFLICT',
        details: { current: 2 },
      });
      expect(lifecycle.publish).not.toHaveBeenCalled();
    });

    it('version 相同但狀態已經變了（例：剛完成）時拋 DATA_TRANSFER_INVALID_STATE 並帶目前狀態', async () => {
      const stored = transferRow({ status: 'running' });
      const { service, repo } = setup({ stored });
      repo.transition.mockResolvedValueOnce(undefined);
      repo.findById
        .mockResolvedValueOnce(stored)
        .mockResolvedValueOnce(transferRow({ status: 'completed' }));
      await expect(service.cancel('transfer-1', { version: 1 }, OWNER)).rejects.toMatchObject({
        code: 'DATA_TRANSFER_INVALID_STATE',
        details: { status: 'completed' },
      });
    });

    it('轉移時已被刪除：拋 DATA_TRANSFER_INVALID_STATE（status null）', async () => {
      const stored = transferRow({ status: 'running' });
      const { service, repo } = setup({ stored });
      repo.transition.mockResolvedValueOnce(undefined);
      repo.findById.mockResolvedValueOnce(stored).mockResolvedValueOnce(undefined);
      await expect(service.cancel('transfer-1', { version: 1 }, OWNER)).rejects.toMatchObject({
        code: 'DATA_TRANSFER_INVALID_STATE',
        details: { status: null },
      });
    });

    it('別人的傳輸：404', async () => {
      const { service } = setup();
      await expect(service.cancel('transfer-1', { version: 1 }, OTHER)).rejects.toMatchObject({
        code: 'DATA_TRANSFER_NOT_FOUND',
      });
    });
  });

  describe('remove', () => {
    it.each(['completed', 'failed', 'cancelled', 'expired'])(
      '%s 的傳輸可以刪除：刪檔、刪列、推播 DELETE',
      async (status) => {
        const stored = transferRow({ status, outputKey: 'transfers/transfer-1/widgets.csv' });
        const { service, repo, storage, lifecycle } = setup({ stored });
        await service.remove('transfer-1', OWNER);
        expect(storage.delete).toHaveBeenCalledWith('transfers/transfer-1/widgets.csv');
        expect(repo.delete).toHaveBeenCalledWith('transfer-1');
        expect(lifecycle.publish).toHaveBeenCalledWith(stored, ChangeKind.DELETE);
      },
    );

    it('沒有產出檔時只刪列', async () => {
      const { service, repo, storage } = setup({ stored: transferRow({ status: 'failed' }) });
      await service.remove('transfer-1', OWNER);
      expect(storage.delete).not.toHaveBeenCalled();
      expect(repo.delete).toHaveBeenCalledWith('transfer-1');
    });

    it.each(['queued', 'running', 'applying'])(
      '%s（還沒結束）不能刪：拋 DATA_TRANSFER_INVALID_STATE',
      async (status) => {
        const { service, repo } = setup({ stored: transferRow({ status }) });
        await expect(service.remove('transfer-1', OWNER)).rejects.toMatchObject({
          code: 'DATA_TRANSFER_INVALID_STATE',
          details: { status },
        });
        expect(repo.delete).not.toHaveBeenCalled();
      },
    );
  });

  describe('download（§6.4、D12）', () => {
    const COMPLETED = transferRow({
      status: 'completed',
      outputKey: 'transfers/transfer-1/widgets.csv',
      outputName: 'widgets.csv',
      totalRows: 5,
    });

    it('重新簽發 FILE_URL_TTL 的連結、以下載當下的權限檢查、寫稽核', async () => {
      const { service, storage, contexts, lifecycle } = setup({ stored: COMPLETED });
      const result = await inTenant(() => service.download('transfer-1', OWNER));

      expect(result).toEqual({
        url: 'https://files.example.com/signed',
        expiresAt: '2026-10-08T07:00:00.000Z',
        fileName: 'widgets.csv',
      });
      expect(contexts.assertHasAll).toHaveBeenCalledWith(
        OWNER,
        ['widget:export'],
        'POST /data-transfers/:id/download',
      );
      expect(storage.presignDownload).toHaveBeenCalledWith('transfers/transfer-1/widgets.csv', {
        disposition: 'attachment',
        fileName: 'widgets.csv',
        expiresIn: 300,
      });
      expect(lifecycle.record).toHaveBeenCalledWith('dataTransfer.download', COMPLETED, {
        type: 'widget',
        format: 'csv',
        rows: 5,
      });
    });

    it('被拿掉匯出權限的人不能下載先前產生的檔案', async () => {
      const { service, contexts, storage } = setup({ stored: COMPLETED });
      contexts.assertHasAll.mockRejectedValueOnce(new AppException('AUTHZ_FORBIDDEN'));
      await expect(inTenant(() => service.download('transfer-1', OWNER))).rejects.toMatchObject({
        code: 'AUTHZ_FORBIDDEN',
      });
      expect(storage.presignDownload).not.toHaveBeenCalled();
    });

    it('資源已不支援匯出時拋 DATA_TRANSFER_TYPE_UNSUPPORTED', async () => {
      const { service } = setup({
        stored: COMPLETED,
        resources: [widgetResource({ exporter: undefined, type: 'gadget' })],
      });
      await expect(inTenant(() => service.download('transfer-1', OWNER))).rejects.toMatchObject({
        code: 'DATA_TRANSFER_TYPE_UNSUPPORTED',
      });
    });

    it('登記的資源沒有 exporter 時以空的權限檢查（防禦）', async () => {
      const { service, registry, contexts } = setup({ stored: COMPLETED });
      vi.spyOn(registry, 'require').mockReturnValueOnce(widgetResource({ exporter: undefined }));
      await inTenant(() => service.download('transfer-1', OWNER));
      expect(contexts.assertHasAll).toHaveBeenCalledWith(OWNER, [], expect.any(String));
    });

    it.each([
      [
        '匯入',
        transferRow({ direction: 'import', status: 'completed' }),
        'DATA_TRANSFER_INVALID_STATE',
      ],
      ['已到期', transferRow({ status: 'expired' }), 'DATA_TRANSFER_EXPIRED'],
      ['還沒完成', transferRow({ status: 'running' }), 'DATA_TRANSFER_INVALID_STATE'],
      [
        '完成但沒有產出物件',
        transferRow({ status: 'completed', outputName: 'widgets.csv' }),
        'DATA_TRANSFER_INVALID_STATE',
      ],
      [
        '完成但沒有檔名',
        transferRow({ status: 'completed', outputKey: 'transfers/x' }),
        'DATA_TRANSFER_INVALID_STATE',
      ],
    ])('%s：拋 %s', async (_name, stored, code) => {
      const { service, storage } = setup({ stored });
      await expect(inTenant(() => service.download('transfer-1', OWNER))).rejects.toMatchObject({
        code,
      });
      expect(storage.presignDownload).not.toHaveBeenCalled();
    });
  });

  describe('resources：操作者可以匯出或匯入的資源', () => {
    const importer = {
      modes: {
        create: { permissions: ['widget:create' as PermissionKey] },
        update: { permissions: ['widget:update' as PermissionKey] },
      },
      uniqueColumns: [],
      create: async () => ({ id: 'x' }),
      update: async () => ({ id: 'x' }),
      resolveTargets: async () => new Map(),
    };

    function resources(): AnyTransferResource[] {
      const { importer: _ignored, ...plain } = exportable();
      return [
        plain,
        {
          ...exportable({ type: 'importOnly', exporter: undefined }),
          columns: [
            {
              key: 'name',
              label: { 'zh-TW': '名稱', 'en-US': 'Name' },
              kind: 'string',
              export: { get: () => '' },
              import: { modes: ['create', 'update'], matchKey: 1, schema: z.string() },
            },
          ],
          importer,
        },
        { ...widgetResource({ type: 'noHint' }) },
      ];
    }

    it('列出有匯出權限的欄位與格式、可用的匯入模式；兩者都沒有的不列出', async () => {
      const ctx = transferContext(['widget:export', 'widget:create']);
      const { service } = setup({ ctx, resources: resources() });
      const { items } = await inTenant(() => service.resources(OWNER, PREFERENCE));

      expect(items).toEqual([
        {
          type: 'widget',
          label: '小工具',
          export: {
            formats: ['csv', 'xlsx', 'json', 'yaml', 'sql'],
            columns: [{ key: 'name', label: '名稱', kind: 'string' }],
            orderHint: '依名稱',
          },
          importModes: [],
        },
        // 有修改模式但沒有 widget:update：只列出新增
        { type: 'importOnly', label: '小工具', export: null, importModes: ['create'] },
        {
          type: 'noHint',
          label: '小工具',
          export: expect.objectContaining({ orderHint: null }),
          importModes: [],
        },
      ]);
    });

    it('沒有任何權限時是空的', async () => {
      const { service } = setup({ ctx: transferContext([]), resources: resources() });
      await expect(inTenant(() => service.resources(OWNER, PREFERENCE))).resolves.toEqual({
        items: [],
      });
    });

    it('有權讀的欄位才出現；標籤用操作者的語系', async () => {
      const ctx = transferContext(['widget:export', 'widget:secret'], { locale: 'en-US' });
      const { service } = setup({ ctx });
      const { items } = await inTenant(() => service.resources(OWNER, PREFERENCE));
      expect(items[0]?.label).toBe('Widgets');
      expect(items[0]?.export?.columns.map((column) => column.key)).toEqual(['name', 'secret']);
      expect(items[0]?.export?.orderHint).toBe('By name');
    });

    it('所屬 feature 沒有啟用的資源不列出', async () => {
      const { service } = setup({
        resources: [exportable({ feature: 'group' as TenantFeature })],
      });
      await expect(inTenant(() => service.resources(OWNER, PREFERENCE))).resolves.toEqual({
        items: [],
      });
    });
  });

  describe('createExport（§6.1）', () => {
    it('以操作者當下的權限檢查，在同一個交易建立並入列；預設全部有權讀的欄位', async () => {
      const { service, repo, jobs, contexts, lifecycle, tx } = setup();
      const dto = await inTenant(() => service.createExport(exportDto(), OWNER, PREFERENCE));

      expect(contexts.assertHasAll).toHaveBeenCalledWith(
        OWNER,
        ['widget:export'],
        'POST /data-transfers/exports',
      );
      expect(repo.countActive).toHaveBeenCalledWith('user-1', tx);
      expect(repo.create).toHaveBeenCalledWith(
        {
          direction: 'export',
          type: 'widget',
          mode: null,
          format: 'csv',
          status: 'queued',
          createdBy: 'user-1',
          locale: 'zh-TW',
          timezone: 'Asia/Taipei',
          params: { scope: { kind: 'filter', filter: {} }, columns: ['name', 'secret'] },
          totalRows: 10,
          expiresAt: EXPIRES,
        },
        tx,
      );
      expect(jobs.enqueue).toHaveBeenCalledWith(
        DATA_TRANSFER_EXPORT_JOB,
        { transferId: 'transfer-new' },
        { tx },
      );
      expect(lifecycle.publish).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'transfer-new' }),
        ChangeKind.CREATE,
      );
      expect(dto.id).toBe('transfer-new');
    });

    it('指定欄位時只匯出那些欄位，依定義的順序', async () => {
      const { service, repo } = setup();
      await inTenant(() =>
        service.createExport(exportDto({ columns: ['secret', 'name'] }), OWNER, PREFERENCE),
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ columns: ['name', 'secret'] }),
        }),
        expect.anything(),
      );
    });

    it('勾選範圍：id 去重', async () => {
      const { service, repo } = setup();
      await inTenant(() =>
        service.createExport(
          exportDto({ scope: { kind: 'ids', ids: ['w-1', 'w-2', 'w-1'] } }),
          OWNER,
          PREFERENCE,
        ),
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ scope: { kind: 'ids', ids: ['w-1', 'w-2'] } }),
        }),
        expect.anything(),
      );
    });

    it('篩選條件交給資源的 assertFilter 做額外檢查', async () => {
      const assertFilter = vi.fn(() => {
        throw new AppException('VALIDATION_FAILED', { fields: { 'filter.range': 'too wide' } });
      });
      const base = exportable();
      const { service, repo } = setup({
        resources: [{ ...base, exporter: { ...base.exporter!, assertFilter } }],
      });
      await expect(
        inTenant(() =>
          service.createExport(
            exportDto({ scope: { kind: 'filter', filter: { keyword: 'ab' } } }),
            OWNER,
            PREFERENCE,
          ),
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(assertFilter).toHaveBeenCalledWith({ keyword: 'ab' });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('不支援的類型拋 DATA_TRANSFER_TYPE_UNSUPPORTED', async () => {
      const { service } = setup();
      await expect(
        inTenant(() => service.createExport(exportDto({ type: 'missing' }), OWNER, PREFERENCE)),
      ).rejects.toMatchObject({ code: 'DATA_TRANSFER_TYPE_UNSUPPORTED' });
    });

    it('登記的資源沒有 exporter 時拋 DATA_TRANSFER_TYPE_UNSUPPORTED（防禦）', async () => {
      const { service, registry } = setup();
      vi.spyOn(registry, 'require').mockReturnValueOnce(widgetResource({ exporter: undefined }));
      await expect(
        inTenant(() => service.createExport(exportDto(), OWNER, PREFERENCE)),
      ).rejects.toMatchObject({
        code: 'DATA_TRANSFER_TYPE_UNSUPPORTED',
        details: { type: 'widget' },
      });
    });

    it('沒有匯出權限時拋 AUTHZ_FORBIDDEN，不建立', async () => {
      const { service, contexts, repo } = setup();
      contexts.assertHasAll.mockRejectedValueOnce(new AppException('AUTHZ_FORBIDDEN'));
      await expect(
        inTenant(() => service.createExport(exportDto(), OWNER, PREFERENCE)),
      ).rejects.toMatchObject({ code: 'AUTHZ_FORBIDDEN' });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('不認得或不能匯出的欄位：拋 VALIDATION_FAILED 並列出', async () => {
      const base = exportable();
      const { service } = setup({
        resources: [
          {
            ...base,
            columns: [
              ...base.columns,
              {
                key: 'note',
                label: { 'zh-TW': '備註', 'en-US': 'Note' },
                kind: 'string',
                import: { modes: ['create'], schema: z.string() },
              },
            ],
          },
        ],
      });
      await expect(
        inTenant(() =>
          service.createExport(
            exportDto({ columns: ['name', 'note', 'ghost'] }),
            OWNER,
            PREFERENCE,
          ),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { columns: 'note,ghost' } },
      });
    });

    it('沒有權讀的欄位：拋 AUTHZ_FORBIDDEN 並列出缺少的權限', async () => {
      const { service } = setup({ ctx: transferContext(['widget:export']) });
      await expect(
        inTenant(() =>
          service.createExport(exportDto({ columns: ['name', 'secret'] }), OWNER, PREFERENCE),
        ),
      ).rejects.toMatchObject({
        code: 'AUTHZ_FORBIDDEN',
        details: { required: ['widget:secret'], missing: ['widget:secret'] },
      });
    });

    it('勾選範圍有格式不符的 id：拋 VALIDATION_FAILED', async () => {
      const { service } = setup();
      await expect(
        inTenant(() =>
          service.createExport(
            exportDto({ scope: { kind: 'ids', ids: ['w-1', 'bad'] } }),
            OWNER,
            PREFERENCE,
          ),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { 'scope.ids': 'invalid id' } },
      });
    });

    it('篩選條件不符資源的 filterSchema：拋 VALIDATION_FAILED，欄位路徑加上 filter.', async () => {
      const { service } = setup();
      await expect(
        inTenant(() =>
          service.createExport(
            exportDto({ scope: { kind: 'filter', filter: { keyword: 'too long' } } }),
            OWNER,
            PREFERENCE,
          ),
        ),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { 'filter.keyword': expect.any(String) } },
      });
    });

    it('篩選條件的驗證沒有 issue 時以 filter: invalid 表示', async () => {
      const base = exportable();
      const filterSchema = {
        safeParse: () => ({ success: false, error: { issues: [], message: 'bad' } }),
      };
      const { service } = setup({
        resources: [
          { ...base, exporter: { ...base.exporter!, filterSchema: filterSchema as never } },
        ],
      });
      await expect(
        inTenant(() => service.createExport(exportDto(), OWNER, PREFERENCE)),
      ).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
        details: { fields: { filter: 'invalid' } },
      });
    });

    it('預估筆數超過上限：拋 DATA_TRANSFER_TOO_MANY_ROWS，不入列', async () => {
      const base = exportable();
      const { service, repo, jobs } = setup({
        resources: [{ ...base, exporter: { ...base.exporter!, count: async () => MAX_ROWS + 1 } }],
      });
      await expect(
        inTenant(() => service.createExport(exportDto(), OWNER, PREFERENCE)),
      ).rejects.toMatchObject({
        code: 'DATA_TRANSFER_TOO_MANY_ROWS',
        details: { max: MAX_ROWS, count: MAX_ROWS + 1 },
      });
      expect(repo.create).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it('剛好等於上限可以建立', async () => {
      const base = exportable();
      const { service, repo } = setup({
        resources: [{ ...base, exporter: { ...base.exporter!, count: async () => MAX_ROWS } }],
      });
      await inTenant(() => service.createExport(exportDto(), OWNER, PREFERENCE));
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it('進行中的傳輸已達每人上限：拋 DATA_TRANSFER_LIMIT_EXCEEDED', async () => {
      const { service, repo, jobs, lifecycle } = setup();
      repo.countActive.mockResolvedValueOnce(3);
      await expect(
        inTenant(() => service.createExport(exportDto(), OWNER, PREFERENCE)),
      ).rejects.toMatchObject({ code: 'DATA_TRANSFER_LIMIT_EXCEEDED', details: { max: 3 } });
      expect(repo.create).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
      expect(lifecycle.publish).not.toHaveBeenCalled();
    });
  });

  describe('rows（§7.7）', () => {
    const IMPORT = transferRow({ direction: 'import', status: 'completed' });

    it('多取一列判斷下一頁；回傳原始 cells 與結果', async () => {
      const { service, repo } = setup({ stored: IMPORT });
      repo.listRows.mockResolvedValueOnce([
        applyRow(1, { changes: { name: ['a', 'b'] } }),
        applyRow(2),
        applyRow(3),
      ]);
      const result = await service.rows(
        'transfer-1',
        { outcome: ['succeeded'], afterRowNo: 0, limit: 2 } as never,
        OWNER,
      );
      expect(repo.listRows).toHaveBeenCalledWith('transfer-1', {
        outcome: ['succeeded'],
        afterRowNo: 0,
        limit: 3,
      });
      expect(result.items).toEqual([
        {
          rowNo: 1,
          sourceRow: 2,
          cells: { name: 'w-1' },
          outcome: 'succeeded',
          error: null,
          changes: { name: ['a', 'b'] },
          resultId: 'id-1',
        },
        expect.objectContaining({ rowNo: 2, changes: null }),
      ]);
      expect(result.nextRowNo).toBe(2);
    });

    it('最後一頁的 nextRowNo 是 null', async () => {
      const { service, repo } = setup({ stored: IMPORT });
      repo.listRows.mockResolvedValueOnce([applyRow(1)]);
      const result = await service.rows('transfer-1', { limit: 2 } as never, OWNER);
      expect(result.nextRowNo).toBeNull();
    });

    it('匯出沒有套用列：拋 DATA_TRANSFER_INVALID_STATE', async () => {
      const { service } = setup({ stored: transferRow({ status: 'completed' }) });
      await expect(service.rows('transfer-1', { limit: 2 } as never, OWNER)).rejects.toMatchObject({
        code: 'DATA_TRANSFER_INVALID_STATE',
      });
    });

    it('已到期：拋 DATA_TRANSFER_EXPIRED', async () => {
      const { service } = setup({
        stored: transferRow({ direction: 'import', status: 'expired' }),
      });
      await expect(service.rows('transfer-1', { limit: 2 } as never, OWNER)).rejects.toMatchObject({
        code: 'DATA_TRANSFER_EXPIRED',
      });
    });
  });
});
