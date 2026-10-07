import { createDraftStore } from '@b2b-system/web-shared/storage';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ImportApi, ImportColumnView, TransferView } from '../../data-transfer';
import { setImportDraftStore } from '../../form';
import { initTestI18n, renderInRouter } from '../../testing';
import { ImportWorkspace } from '../ImportWorkspace';

// jsdom 沒有 ResizeObserver；預覽表格用它量測可視範圍
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const COLUMNS: ImportColumnView[] = [
  {
    key: 'email',
    label: 'Email',
    kind: 'string',
    required: true,
    multiple: false,
    matchKey: null,
    unique: true,
    nullable: false,
    hint: null,
    options: null,
    transitions: null,
  },
];

function fakeApi(overrides: Partial<ImportApi> = {}): ImportApi {
  return {
    resourcesKey: ['resources'],
    fetchResources: async () => ({ items: [] }),
    transferKey: (id) => ['transfer', id],
    transferRowsKey: (id) => ['rows', id],
    fetchTransfer: async () => ({ status: 'queued' }) as TransferView,
    cancel: async () => ({}) as TransferView,
    download: async () => ({ url: '', fileName: '' }),
    createExport: async () => ({}) as TransferView,
    fetchRows: async () => ({ items: [], nextRowNo: null }),
    downloadReport: async () => ({ blob: new Blob([]), fileName: '' }),
    columnsKey: (type, mode) => ['columns', type, mode],
    fetchColumns: async () => ({ items: COLUMNS, readOnly: [] }),
    downloadTemplate: async () => ({ blob: new Blob([]), fileName: 't.csv' }),
    analyze: vi.fn(async () => ({
      status: 'ok' as const,
      fileName: 'users.csv',
      columns: COLUMNS,
      ignored: [],
      rows: [
        { rowNo: 1, sourceRow: 2, cells: { email: 'a@example.com' } },
        { rowNo: 2, sourceRow: 3, cells: { email: 'bad' } },
      ],
      results: [
        { rowNo: 1, issues: [] },
        {
          rowNo: 2,
          issues: [
            {
              column: 'email',
              code: 'invalidFormat',
              params: { format: 'email' },
              severity: 'error' as const,
            },
          ],
        },
      ],
    })),
    validate: vi.fn(async () => ({ rows: [] })),
    searchOptions: async () => [],
    createImport: vi.fn(async () => ({ id: 'transfer-1' }) as TransferView),
    ...overrides,
  };
}

describe('ImportWorkspace（docs/architecture/backend/22-data-transfer.md §7.2）', () => {
  beforeAll(async () => {
    setImportDraftStore(createDraftStore({ indexedDB: undefined }));
    await initTestI18n();
  });
  afterAll(() => setImportDraftStore(undefined));

  it('上傳 → 分析 → 預覽標出錯誤的儲存格 → 勾選略過後套用', async () => {
    const api = fakeApi();
    const onTransferChange = vi.fn();
    renderInRouter(
      <ImportWorkspace
        api={api}
        type="user"
        mode="create"
        modes={['create']}
        onModeChange={vi.fn()}
        transferId={null}
        onTransferChange={onTransferChange}
      />,
    );
    const input = await screen.findByLabelText('選擇檔案', { selector: 'input' });
    await userEvent.upload(
      input,
      new File(['email\na@example.com'], 'users.csv', { type: 'text/csv' }),
    );
    await userEvent.click(screen.getByTestId('import-analyze'));

    expect(await screen.findByTestId('import-preview')).toBeInTheDocument();
    expect(api.analyze).toHaveBeenCalledWith('user', expect.any(File), {
      encoding: 'auto',
      mode: 'create',
    });
    expect(screen.getByText('bad')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('bad')).toHaveAttribute('title', 'Email 格式不正確');
    expect(screen.getByTestId('import-summary')).toHaveTextContent('共 2 列：1 列錯誤');

    await userEvent.click(screen.getByTestId('import-submit'));
    expect(screen.getByTestId('import-submit-confirm')).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /略過有錯誤的列/ }));
    await userEvent.click(screen.getByTestId('import-submit-confirm'));
    await waitFor(() => expect(onTransferChange).toHaveBeenCalledWith('transfer-1'));
    expect(api.createImport).toHaveBeenCalledWith({
      type: 'user',
      mode: 'create',
      fileName: 'users.csv',
      skipInvalid: true,
      rows: [
        { rowNo: 1, sourceRow: 2, cells: { email: 'a@example.com' } },
        { rowNo: 2, sourceRow: 3, cells: { email: 'bad' } },
      ],
    });
  });
});
