import { vi } from 'vitest';

import type { DataTransferApi, TransferView } from '../types';

/** 一筆傳輸的檢視；預設是排隊中的使用者匯出。 */
export function transfer(overrides: Partial<TransferView> = {}): TransferView {
  return {
    id: 't1',
    direction: 'export',
    type: 'user',
    mode: null,
    format: 'csv',
    status: 'queued',
    scopeKind: 'filter',
    sourceName: null,
    outputName: null,
    outputSize: null,
    totalRows: 3,
    processedRows: 0,
    succeededRows: 0,
    failedRows: 0,
    skippedRows: 0,
    errorCode: null,
    version: 1,
    expiresAt: '2026-10-15T00:00:00Z',
    finishedAt: null,
    createdAt: '2026-10-08T00:00:00Z',
    ...overrides,
  };
}

/** 匯出與傳輸列表用到的 API；預設可以匯出使用者，傳輸查回來已完成。 */
export function fakeTransferApi(overrides: Partial<DataTransferApi> = {}): DataTransferApi {
  return {
    resourcesKey: ['resources'],
    fetchResources: async () => ({
      items: [
        {
          type: 'user',
          label: '使用者',
          export: {
            formats: ['csv', 'xlsx', 'sql'],
            columns: [
              { key: 'email', label: 'Email', kind: 'string' },
              { key: 'roles', label: '角色', kind: 'reference' },
            ],
            orderHint: '依建立時間排序',
          },
          importModes: ['create'],
        },
      ],
    }),
    transferKey: (id) => ['transfer', id],
    transferRowsKey: (id) => ['rows', id],
    fetchTransfer: async () => transfer({ status: 'completed', processedRows: 3 }),
    cancel: async () => transfer({ status: 'cancelled' }),
    download: async () => ({ url: 'https://files.test/users.csv', fileName: 'users.csv' }),
    createExport: vi.fn(async () => transfer()),
    fetchRows: async () => ({ items: [], nextRowNo: null }),
    downloadReport: async () => ({ blob: new Blob([]), fileName: 'r.csv' }),
    ...overrides,
  };
}
