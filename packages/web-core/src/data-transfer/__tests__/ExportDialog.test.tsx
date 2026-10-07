import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AllProviders, initTestI18n } from '../../testing';
import { ExportDialog } from '../ExportDialog';
import type { DataTransferApi, TransferView } from '../types';

function transfer(overrides: Partial<TransferView> = {}): TransferView {
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

function fakeApi(overrides: Partial<DataTransferApi> = {}): DataTransferApi {
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

describe('ExportDialog（docs/architecture/backend/22-data-transfer.md §8.2）', () => {
  beforeAll(() => initTestI18n());

  it('有勾選時預設匯出勾選的 id；送出後完成就自動下載並關閉', async () => {
    const api = fakeApi();
    const onOpenChange = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(
      <ExportDialog
        open
        onOpenChange={onOpenChange}
        api={api}
        type="user"
        selectedIds={['u1', 'u2']}
        filter={{ keyword: 'acme' }}
        matchingTotal={40}
      />,
      { wrapper: AllProviders },
    );
    expect(await screen.findByText('已勾選 2 筆')).toBeInTheDocument();
    await userEvent.click(await screen.findByTestId('export-submit'));
    expect(api.createExport).toHaveBeenCalledWith({
      type: 'user',
      format: 'csv',
      scope: { kind: 'ids', ids: ['u1', 'u2'] },
    });
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    click.mockRestore();
  });

  it('只選部分欄位時才送 columns；沒有勾選時範圍是目前的篩選', async () => {
    const api = fakeApi({ fetchTransfer: async () => transfer() });
    render(
      <ExportDialog
        open
        onOpenChange={vi.fn()}
        api={api}
        type="user"
        filter={{ keyword: 'acme' }}
        matchingTotal={40}
      />,
      { wrapper: AllProviders },
    );
    await userEvent.click(await screen.findByRole('checkbox', { name: '角色' }));
    await userEvent.click(screen.getByTestId('export-submit'));
    expect(api.createExport).toHaveBeenCalledWith({
      type: 'user',
      format: 'csv',
      scope: { kind: 'filter', filter: { keyword: 'acme' } },
      columns: ['email'],
    });
    expect(await screen.findByTestId('export-progress')).toHaveAttribute('data-value', 'queued');
  });
});
