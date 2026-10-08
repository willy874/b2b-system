import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors';
import { AllProviders, initTestI18n } from '../../testing';
import { TransferTable } from '../TransferTable';
import type { TransferTableProps } from '../TransferTable';
import type { TransferView } from '../types';
import { transfer } from './fakeTransferApi';

beforeAll(() => initTestI18n());

function renderTable(items: TransferView[], overrides: Partial<TransferTableProps> = {}) {
  const props: TransferTableProps = {
    items,
    loading: false,
    error: null,
    onRetry: vi.fn(),
    pagination: { offset: 0, limit: 20, total: items.length, onChange: vi.fn() },
    resourceLabel: (type) => (type === 'user' ? '使用者' : type),
    onDownload: vi.fn(async () => undefined),
    onCancel: vi.fn(async () => undefined),
    onDelete: vi.fn(async () => undefined),
    renderResultLink: (item) => (
      <a href={`/user/import?transfer=${item.id}`} data-testid="result-link">
        查看結果
      </a>
    ),
    ...overrides,
  };
  render(<TransferTable {...props} />, { wrapper: AllProviders });
  return props;
}

const rowOf = (id: string) =>
  screen.getAllByTestId('table-row').find((row) => row.dataset.value === id) as HTMLElement;

describe('TransferTable（我的匯入匯出，docs/architecture/frontend/21-data-transfer.md §5）', () => {
  it('匯出：顯示格式、輸出檔名與筆數；完成後可以下載', async () => {
    const props = renderTable([
      transfer({ id: 'e1', status: 'completed', outputName: 'users.csv', totalRows: 1200 }),
    ]);
    const row = rowOf('e1');

    expect(row).toHaveTextContent('匯出');
    expect(row).toHaveTextContent('CSV');
    expect(row).toHaveTextContent('使用者');
    expect(row).toHaveTextContent('users.csv');
    expect(row).toHaveTextContent('1,200 筆');
    expect(within(row).getByTestId('data-transfer-status')).toHaveTextContent('已完成');

    await userEvent.click(within(row).getByTestId('data-transfer-download'));
    expect(props.onDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
  });

  it('匯入：顯示模式、來源檔名、成功／失敗／略過；結束後有查看結果的連結', () => {
    renderTable([
      transfer({
        id: 'i1',
        direction: 'import',
        mode: 'update',
        status: 'completed',
        sourceName: 'fix.xlsx',
        succeededRows: 5,
        failedRows: 1,
        skippedRows: 2,
      }),
    ]);
    const row = rowOf('i1');

    expect(row).toHaveTextContent('修改');
    expect(row).toHaveTextContent('fix.xlsx');
    expect(row).toHaveTextContent('成功 5／失敗 1／略過 2');
    expect(within(row).getByTestId('result-link')).toBeInTheDocument();
    expect(within(row).queryByTestId('data-transfer-download')).not.toBeInTheDocument();
  });

  it('進行中：保留期限顯示 —，只能取消（確認後才呼叫）', async () => {
    const props = renderTable([transfer({ id: 'r1', status: 'running' })]);
    const row = rowOf('r1');
    expect(row).toHaveTextContent('—');
    expect(within(row).queryByTestId('data-transfer-delete')).not.toBeInTheDocument();

    await userEvent.click(within(row).getByTestId('data-transfer-cancel'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('取消這筆傳輸？');
    expect(props.onCancel).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId('alert-dialog-confirm')).toHaveTextContent('取消');
    await userEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));

    await waitFor(() =>
      expect(props.onCancel).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' })),
    );
  });

  it('已結束：確認後刪除', async () => {
    const props = renderTable([transfer({ id: 'f1', status: 'failed' })]);

    await userEvent.click(within(rowOf('f1')).getByTestId('data-transfer-delete'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('刪除這筆紀錄？');
    await userEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));

    await waitFor(() =>
      expect(props.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1' })),
    );
  });

  it('過期的匯入沒有查看結果；沒有資料的匯出不能下載', () => {
    renderTable([
      transfer({ id: 'x1', direction: 'import', mode: 'create', status: 'expired' }),
      transfer({ id: 'x2', status: 'completed', totalRows: 0 }),
    ]);
    expect(rowOf('x1')).toHaveTextContent('—');
    expect(within(rowOf('x1')).queryByTestId('result-link')).not.toBeInTheDocument();
    expect(within(rowOf('x2')).queryByTestId('data-transfer-download')).not.toBeInTheDocument();
  });

  it('下載失敗時以 toast 顯示錯誤', async () => {
    renderTable([transfer({ id: 'e1', status: 'completed' })], {
      onDownload: vi.fn(async () => {
        throw new AppError('DATA_TRANSFER_NOT_FOUND', 404);
      }),
    });

    await userEvent.click(within(rowOf('e1')).getByTestId('data-transfer-download'));

    expect(await screen.findByText('找不到這筆匯入或匯出。')).toBeInTheDocument();
  });

  it('沒有資料時顯示空狀態', () => {
    renderTable([]);
    expect(screen.getByText('還沒有匯入或匯出')).toBeInTheDocument();
  });

  it('取消失敗時以 toast 顯示錯誤', async () => {
    renderTable([transfer({ id: 'r1', status: 'queued' })], {
      onCancel: vi.fn(async () => {
        throw new AppError('DATA_TRANSFER_INVALID_STATE', 409);
      }),
    });

    await userEvent.click(within(rowOf('r1')).getByTestId('data-transfer-cancel'));
    await userEvent.click(await screen.findByTestId('alert-dialog-confirm'));

    expect(
      await screen.findByText('這筆匯入或匯出目前的狀態無法進行這個操作，請重新整理後再試。'),
    ).toBeInTheDocument();
  });
});
