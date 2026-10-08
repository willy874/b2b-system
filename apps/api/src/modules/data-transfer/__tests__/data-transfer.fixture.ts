import { vi } from 'vitest';

import type { PermissionKey } from '@/common/types';
import type { DataTransferRow } from '@/db/schema';

import type { AnyTransferResource, TransferContext } from '../data-transfer.types';

/** 單元測試共用的傳輸列；欄位依 `data_transfers` 的預設值。 */
export function transferRow(overrides: Partial<DataTransferRow> = {}): DataTransferRow {
  return {
    id: 'transfer-1',
    direction: 'export',
    type: 'widget',
    mode: null,
    format: 'csv',
    status: 'queued',
    createdBy: 'user-1',
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    params: { scope: { kind: 'filter', filter: {} }, columns: ['name'] },
    sourceName: null,
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

/** 以權限鍵集合決定 `can()` 的脈絡。 */
export function transferContext(
  granted: readonly string[] = [],
  overrides: Partial<TransferContext> = {},
): TransferContext {
  const keys = new Set(granted);
  return {
    actor: { id: 'user-1', email: 'owner@example.com', status: 'active' },
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    signal: new AbortController().signal,
    can: (key: PermissionKey) => keys.has(key),
    ...overrides,
  };
}

/** 一個可匯出的資源：name（不需權限）、secret（要 widget:secret）、note（只能匯入）。 */
export function widgetResource(overrides: Partial<AnyTransferResource> = {}): AnyTransferResource {
  return {
    type: 'widget',
    fileBaseName: 'widgets',
    label: { 'zh-TW': '小工具', 'en-US': 'Widgets' },
    columns: [
      {
        key: 'name',
        label: { 'zh-TW': '名稱', 'en-US': 'Name' },
        kind: 'string',
        export: { get: (record: { name: string }) => record.name },
      },
      {
        key: 'secret',
        label: { 'zh-TW': '機密', 'en-US': 'Secret' },
        kind: 'string',
        permission: 'widget:secret' as PermissionKey,
        export: { get: (record: { secret?: string }) => record.secret },
      },
    ],
    exporter: {
      permissions: ['widget:export' as PermissionKey],
      filterSchema: { safeParse: vi.fn() } as never,
      idSchema: { safeParse: vi.fn() } as never,
      iterate: vi.fn(),
      count: vi.fn(async () => 0),
    },
    ...overrides,
  };
}
