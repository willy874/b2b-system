import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ApplyRowView, ImportApi } from '../../data-transfer';
import { AppError } from '../../errors';
import { AllProviders, initTestI18n } from '../../testing';
import { ImportResult } from '../ImportResult';
import type { ImportResultProps } from '../ImportResult';
import { fakeImportApi, importColumn, transfer } from './fakeImportApi';

beforeAll(() => initTestI18n());
afterEach(() => vi.restoreAllMocks());

function applyRow(overrides: Partial<ApplyRowView> = {}): ApplyRowView {
  return {
    rowNo: 1,
    sourceRow: 2,
    cells: { email: 'a@example.com' },
    outcome: 'succeeded',
    error: null,
    changes: null,
    resultId: null,
    ...overrides,
  };
}

const finished = transfer({
  id: 'transfer-1',
  direction: 'import',
  mode: 'create',
  status: 'completed',
  sourceName: 'users.csv',
  totalRows: 3,
  processedRows: 3,
  succeededRows: 1,
  failedRows: 2,
  skippedRows: 0,
});

function renderResult(api: ImportApi, props: Partial<ImportResultProps> = {}) {
  const onReimport = vi.fn();
  const onNewImport = vi.fn();
  render(
    <ImportResult
      api={api}
      type="user"
      transferId="transfer-1"
      onReimport={onReimport}
      onNewImport={onNewImport}
      {...props}
    />,
    { wrapper: AllProviders },
  );
  return { onReimport, onNewImport };
}

describe('ImportResult（套用的進度與結果，docs/architecture/backend/22-data-transfer.md §7.7）', () => {
  it('進行中：顯示進度，可以取消', async () => {
    const running = transfer({
      id: 'transfer-1',
      direction: 'import',
      status: 'applying',
      totalRows: 10,
      processedRows: 4,
      version: 7,
    });
    const cancel = vi.fn(async () => running);
    renderResult(fakeImportApi({ fetchTransfer: async () => running, cancel }));

    const progress = await screen.findByTestId('import-progress');
    expect(progress).toHaveAttribute('data-value', 'applying');
    expect(progress).toHaveTextContent('正在套用… 4／10');

    await userEvent.click(screen.getByTestId('import-cancel'));
    expect(cancel).toHaveBeenCalledWith('transfer-1', 7);
  });

  it('結束：計數、失敗的列排前面，原因是驗證問題或錯誤碼；修改的列列出變更', async () => {
    const fetchRows = vi.fn(async () => ({
      items: [
        applyRow({ rowNo: 1, sourceRow: 2, outcome: 'succeeded', resultId: 'u1' }),
        applyRow({
          rowNo: 2,
          sourceRow: 3,
          outcome: 'failed',
          error: {
            issues: [
              {
                column: 'email',
                code: 'alreadyExists',
                params: { value: 'b@x' },
                severity: 'error',
              },
            ],
          },
        }),
        applyRow({
          rowNo: 3,
          sourceRow: null,
          outcome: 'failed',
          error: { code: 'DATA_TRANSFER_NOT_FOUND' },
        }),
        applyRow({
          rowNo: 4,
          sourceRow: 5,
          outcome: 'skipped',
          changes: { name: ['', 'Bob'], status: ['active', ''] },
        }),
      ],
      nextRowNo: null,
    }));
    renderResult(fakeImportApi({ fetchTransfer: async () => finished, fetchRows }), {
      renderRecordLink: (id) => <a href={`/user/${id}`}>查看 {id}</a>,
    });

    expect(await screen.findByTestId('import-result')).toHaveAttribute('data-value', 'completed');
    expect(screen.getByTestId('import-result-succeeded')).toHaveAttribute('data-value', '1');
    expect(screen.getByTestId('import-result-failed')).toHaveAttribute('data-value', '2');
    await waitFor(() => expect(screen.getAllByTestId('import-result-row')).toHaveLength(4));
    const rows = screen.getAllByTestId('import-result-row');
    expect(rows.map((row) => row.dataset.value)).toEqual([
      'failed',
      'failed',
      'skipped',
      'succeeded',
    ]);
    expect(rows[0]).toHaveTextContent('「b@x」已經存在');
    expect(rows[1]).toHaveTextContent('找不到這筆匯入或匯出。');
    // 沒有來源列號時顯示 rowNo
    expect(rows[1]).toHaveTextContent('3');
    expect(rows[2]).toHaveTextContent('name：— → Bob；status：active → —');
    expect(within(rows[3]!).getByRole('link', { name: '查看 u1' })).toBeInTheDocument();
  });

  it('整批失敗時顯示錯誤碼的訊息', async () => {
    renderResult(
      fakeImportApi({
        fetchTransfer: async () =>
          transfer({ ...finished, status: 'failed', errorCode: 'DATA_TRANSFER_INVALID_STATE' }),
      }),
    );
    expect(
      await screen.findByText('這筆匯入或匯出目前的狀態無法進行這個操作，請重新整理後再試。'),
    ).toBeInTheDocument();
  });

  it('過期的傳輸不查逐列結果', async () => {
    const fetchRows = vi.fn(async () => ({ items: [], nextRowNo: null }));
    renderResult(
      fakeImportApi({ fetchTransfer: async () => ({ ...finished, status: 'expired' }), fetchRows }),
    );
    expect(await screen.findByTestId('import-result')).toHaveAttribute('data-value', 'expired');
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it('下載結果報告（全部或只有失敗的列）', async () => {
    const createObjectURL = vi.fn(() => 'blob:report');
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const downloadReport = vi.fn(async () => ({ blob: new Blob(['x']), fileName: 'report.xlsx' }));
    try {
      renderResult(fakeImportApi({ fetchTransfer: async () => finished, downloadReport }));

      await userEvent.click(await screen.findByTestId('import-report'));
      await userEvent.click(screen.getByRole('button', { name: '只下載失敗的列' }));

      await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
      expect(downloadReport.mock.calls).toEqual([
        ['transfer-1', { format: 'xlsx', rows: 'all' }],
        ['transfer-1', { format: 'xlsx', rows: 'failed' }],
      ]);
    } finally {
      Object.assign(URL, original);
    }
  });

  it('下載報告失敗時以 toast 顯示錯誤', async () => {
    renderResult(
      fakeImportApi({
        fetchTransfer: async () => finished,
        downloadReport: async () => {
          throw new AppError('DATA_TRANSFER_NOT_FOUND', 404);
        },
      }),
    );
    await userEvent.click(await screen.findByTestId('import-report'));
    expect(await screen.findByText('找不到這筆匯入或匯出。')).toBeInTheDocument();
  });

  it('以失敗的列重新匯入：逐頁取回失敗的列，只帶用到的欄位，列號重新編', async () => {
    const fetchRows = vi.fn<ImportApi['fetchRows']>(async (_id, query) => {
      if (!query.outcome) return { items: [], nextRowNo: null };
      return query.afterRowNo === undefined
        ? {
            items: [
              applyRow({
                rowNo: 4,
                sourceRow: 5,
                cells: { email: 'x@example.com' },
                outcome: 'failed',
              }),
            ],
            nextRowNo: 4,
          }
        : {
            items: [
              applyRow({
                rowNo: 9,
                sourceRow: 10,
                cells: { email: 'y@example.com' },
                outcome: 'failed',
              }),
            ],
            nextRowNo: null,
          };
    });
    const name = importColumn({ key: 'name', label: '名稱', required: false, unique: false });
    const { onReimport } = renderResult(
      fakeImportApi({
        fetchTransfer: async () => finished,
        fetchRows,
        fetchColumns: async () => ({ items: [importColumn(), name], readOnly: [] }),
      }),
    );

    await userEvent.click(await screen.findByTestId('import-retry-failed'));

    await waitFor(() => expect(onReimport).toHaveBeenCalled());
    expect(fetchRows).toHaveBeenCalledWith('transfer-1', {
      outcome: ['failed'],
      afterRowNo: 4,
      limit: 1000,
    });
    expect(onReimport).toHaveBeenCalledWith(
      [importColumn()],
      [
        { rowNo: 1, sourceRow: 5, cells: { email: 'x@example.com' } },
        { rowNo: 2, sourceRow: 10, cells: { email: 'y@example.com' } },
      ],
      'users.csv',
    );
  });

  it('重新匯入時取得失敗的列出錯，以 toast 顯示', async () => {
    const fetchRows = vi.fn<ImportApi['fetchRows']>(async (_id, query) => {
      if (query.outcome) throw new AppError('DATA_TRANSFER_NOT_FOUND', 404);
      return { items: [], nextRowNo: null };
    });
    const { onReimport } = renderResult(
      fakeImportApi({ fetchTransfer: async () => finished, fetchRows }),
    );

    await userEvent.click(await screen.findByTestId('import-retry-failed'));

    expect(await screen.findByText('找不到這筆匯入或匯出。')).toBeInTheDocument();
    expect(onReimport).not.toHaveBeenCalled();
    expect(screen.getByTestId('import-retry-failed')).toBeEnabled();
  });

  it('沒有失敗的列時不提供重新匯入；「再匯入一份」回到上傳', async () => {
    const { onNewImport } = renderResult(
      fakeImportApi({ fetchTransfer: async () => ({ ...finished, failedRows: 0 }) }),
    );
    await userEvent.click(await screen.findByTestId('import-new'));

    expect(onNewImport).toHaveBeenCalled();
    expect(screen.queryByTestId('import-retry-failed')).not.toBeInTheDocument();
  });
});
