import type { DataTransferApi, ImportApi } from '@b2b-system/web-core/data-transfer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getImportColumnsQueryKeys } from '@/apis/data-transfer/get-import-columns/query';
import { getTransferResourcesQueryKeys } from '@/apis/data-transfer/get-transfer-resources/query';
import { getTransferRowsQueryKeys } from '@/apis/data-transfer/get-transfer-rows/query';
import { getTransferQueryKeys } from '@/apis/data-transfer/get-transfer/query';

/**
 * 各 feature 交給 web-core 匯出對話框、匯入頁的 API 物件（docs/architecture/backend/22-data-transfer.md §8.1）
 * 都是同一組端點的轉接：這裡把 fetcher 換成假的，驗證每個方法把參數攤平成正確的 request。
 * 在測試檔匯入本檔即可（`vi.mock` 在本檔，會先於受測模組套用）。
 */
const fetchers = vi.hoisted(() => ({
  resources: vi.fn(),
  transfer: vi.fn(),
  rows: vi.fn(),
  cancel: vi.fn(),
  download: vi.fn(),
  createExport: vi.fn(),
  report: vi.fn(),
  columns: vi.fn(),
  template: vi.fn(),
  analyze: vi.fn(),
  validate: vi.fn(),
  options: vi.fn(),
  targets: vi.fn(),
  createImport: vi.fn(),
}));

vi.mock('@/apis/data-transfer/get-transfer-resources/fetcher', () => ({
  fetchTransferResourcesQuery: fetchers.resources,
}));
vi.mock('@/apis/data-transfer/get-transfer/fetcher', () => ({
  fetchTransferQuery: fetchers.transfer,
}));
vi.mock('@/apis/data-transfer/get-transfer-rows/fetcher', () => ({
  fetchTransferRowsQuery: fetchers.rows,
}));
vi.mock('@/apis/data-transfer/cancel-transfer/fetcher', () => ({
  fetchCancelTransferMutation: fetchers.cancel,
}));
vi.mock('@/apis/data-transfer/download-transfer/fetcher', () => ({
  fetchDownloadTransferMutation: fetchers.download,
}));
vi.mock('@/apis/data-transfer/create-export/fetcher', () => ({
  fetchCreateExportMutation: fetchers.createExport,
}));
vi.mock('@/apis/data-transfer/download-transfer-report/fetcher', () => ({
  fetchTransferReport: fetchers.report,
}));
vi.mock('@/apis/data-transfer/get-import-columns/fetcher', () => ({
  fetchImportColumnsQuery: fetchers.columns,
}));
vi.mock('@/apis/data-transfer/download-import-template/fetcher', () => ({
  fetchImportTemplate: fetchers.template,
}));
vi.mock('@/apis/data-transfer/analyze-import/fetcher', () => ({
  fetchAnalyzeImport: fetchers.analyze,
}));
vi.mock('@/apis/data-transfer/validate-import-rows/fetcher', () => ({
  fetchValidateImportRows: fetchers.validate,
}));
vi.mock('@/apis/data-transfer/search-import-options/fetcher', () => ({
  fetchImportOptions: fetchers.options,
}));
vi.mock('@/apis/data-transfer/search-import-targets/fetcher', () => ({
  fetchImportTargets: fetchers.targets,
}));
vi.mock('@/apis/data-transfer/create-import/fetcher', () => ({
  fetchCreateImportMutation: fetchers.createImport,
}));

const RESULT = { ok: true };

function resetFetchers(): void {
  for (const fn of Object.values(fetchers)) fn.mockReset().mockResolvedValue(RESULT);
}

/** 匯出（與「我的匯入匯出」）用的方法：query key 與每個 fetcher 收到的參數。 */
export function describeDataTransferApi(name: string, api: DataTransferApi): void {
  describe(`${name}（DataTransferApi）`, () => {
    const signal = new AbortController().signal;
    beforeEach(resetFetchers);

    it('query key 沿用 data-transfer 的 query，與其他畫面共用快取', () => {
      expect(api.resourcesKey).toEqual(getTransferResourcesQueryKeys());
      expect(api.transferKey('t1')).toEqual(getTransferQueryKeys('t1'));
      expect(api.transferRowsKey('t1', ['failed'])).toEqual(
        getTransferRowsQueryKeys('t1', ['failed']),
      );
    });

    it('讀取類方法帶上 signal，參數攤平到 params', async () => {
      await expect(api.fetchResources(signal)).resolves.toBe(RESULT);
      expect(fetchers.resources).toHaveBeenCalledWith({ params: undefined, signal });

      await api.fetchTransfer('t1', signal);
      expect(fetchers.transfer).toHaveBeenCalledWith({
        params: { transferId: 't1' },
        signal,
      });

      await api.fetchRows('t1', { offset: 50, limit: 50, outcome: 'failed' } as never, signal);
      expect(fetchers.rows).toHaveBeenCalledWith({
        params: { transferId: 't1', offset: 50, limit: 50, outcome: 'failed' },
        signal,
      });
    });

    it('取消帶 version（樂觀鎖），下載、建立匯出、下載報告各打對應的端點', async () => {
      await api.cancel('t1', 3);
      expect(fetchers.cancel).toHaveBeenCalledWith({
        params: { transferId: 't1', version: 3 },
      });

      await api.download('t1');
      expect(fetchers.download).toHaveBeenCalledWith({ params: { transferId: 't1' } });

      const body = { type: 'user', format: 'csv' } as never;
      await api.createExport(body);
      expect(fetchers.createExport).toHaveBeenCalledWith({ params: body });

      await api.downloadReport('t1', { outcome: 'failed' } as never);
      expect(fetchers.report).toHaveBeenCalledWith({
        params: { transferId: 't1', outcome: 'failed' },
      });
    });
  });
}

/** 匯入頁另外用到的方法（匯出的部分以 `describeDataTransferApi` 驗證）。 */
export function describeImportApi(name: string, api: ImportApi): void {
  describeDataTransferApi(name, api);

  describe(`${name}（ImportApi）`, () => {
    const signal = new AbortController().signal;
    beforeEach(resetFetchers);

    it('欄位定義的 query key 與讀取', async () => {
      expect(api.columnsKey('user', 'create')).toEqual(getImportColumnsQueryKeys('user', 'create'));
      await api.fetchColumns('user', 'update', signal);
      expect(fetchers.columns).toHaveBeenCalledWith({
        params: { type: 'user', mode: 'update' },
        signal,
      });
    });

    it('下載範本、分析檔案：參數攤平', async () => {
      await api.downloadTemplate('user', 'create', 'xlsx');
      expect(fetchers.template).toHaveBeenCalledWith({
        params: { type: 'user', mode: 'create', format: 'xlsx' },
      });

      const file = new File(['a'], 'users.csv');
      await api.analyze('user', file, { mode: 'create' } as never);
      expect(fetchers.analyze).toHaveBeenCalledWith({
        params: { type: 'user', file, mode: 'create' },
      });
    });

    it('驗證列：有同檔引用時才帶 fileKeys', async () => {
      const rows = [{ index: 0, values: {} }] as never;
      await api.validate('user', 'create', rows);
      expect(fetchers.validate).toHaveBeenLastCalledWith({
        params: { type: 'user', mode: 'create', rows },
      });

      await api.validate('user', 'create', rows, { manager: ['a@x.test'] });
      expect(fetchers.validate).toHaveBeenLastCalledWith({
        params: { type: 'user', mode: 'create', rows, fileKeys: { manager: ['a@x.test'] } },
      });
    });

    it('選項與比對目標的搜尋回傳 items', async () => {
      fetchers.options.mockResolvedValue({ items: [{ id: 'r1', label: 'Admin' }] });
      await expect(api.searchOptions('user', 'roles', 'adm')).resolves.toEqual([
        { id: 'r1', label: 'Admin' },
      ]);
      expect(fetchers.options).toHaveBeenCalledWith({
        params: { type: 'user', column: 'roles', keyword: 'adm' },
      });

      fetchers.targets.mockResolvedValue({ items: [{ id: 'u1', label: 'Amy' }] });
      await expect(api.searchTargets?.('user', 'am')).resolves.toEqual([
        { id: 'u1', label: 'Amy' },
      ]);
      expect(fetchers.targets).toHaveBeenCalledWith({
        params: { type: 'user', keyword: 'am' },
      });
    });

    it('建立匯入：body 原樣送出', async () => {
      const body = { type: 'user', mode: 'create', skipInvalid: true, rows: [] } as never;
      await api.createImport(body);
      expect(fetchers.createImport).toHaveBeenCalledWith({ params: body });
    });
  });
}
