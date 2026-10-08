import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../errors';
import { AllProviders, initTestI18n } from '../../testing';
import { ExportDialog } from '../ExportDialog';
import type { ExportDialogProps } from '../ExportDialog';
import { fakeTransferApi as fakeApi, transfer } from './fakeTransferApi';

describe('ExportDialog（docs/architecture/backend/22-data-transfer.md §8.2）', () => {
  beforeAll(() => initTestI18n());
  // 欄位的選擇記在本機（下次開啟沿用）：每個案例從沒有偏好開始
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

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

describe('ExportDialog（進度、失敗與欄位偏好）', () => {
  beforeAll(() => initTestI18n());
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  function renderDialog(
    api: ReturnType<typeof fakeApi>,
    props: Omit<Partial<ExportDialogProps>, 'open' | 'onOpenChange' | 'api' | 'type'> = {},
  ) {
    const onOpenChange = vi.fn();
    const view = render(
      <ExportDialog
        open
        onOpenChange={onOpenChange}
        api={api}
        type="user"
        filter={{}}
        {...props}
      />,
      { wrapper: AllProviders },
    );
    return { onOpenChange, ...view };
  }

  it('沒有篩選總數時範圍是「全部」，並顯示排序說明', async () => {
    renderDialog(fakeApi());
    expect(await screen.findByText('符合目前條件的全部資料')).toBeInTheDocument();
    expect(await screen.findByText('依建立時間排序')).toBeInTheDocument();
  });

  it('全選了符合條件的全部時，不提供「已勾選」的範圍', async () => {
    renderDialog(fakeApi(), { selectedIds: ['u1'], allMatchingSelected: true, matchingTotal: 9 });
    expect(await screen.findByText('符合目前篩選的全部，約 9 筆')).toBeInTheDocument();
    expect(screen.queryByText('已勾選 1 筆')).not.toBeInTheDocument();
  });

  it('取消全選欄位時不能送出；再全選就可以', async () => {
    renderDialog(fakeApi());
    const selectAll = await screen.findByRole('checkbox', { name: '全選' });
    await waitFor(() => expect(selectAll).toBeChecked());

    await userEvent.click(selectAll);
    expect(screen.getByTestId('export-submit')).toBeDisabled();

    await userEvent.click(screen.getByRole('checkbox', { name: '全選' }));
    expect(screen.getByTestId('export-submit')).toBeEnabled();
  });

  it('上次選的欄位下次開啟沿用', async () => {
    const api = fakeApi({ fetchTransfer: async () => transfer() });
    const first = renderDialog(api);
    await userEvent.click(await screen.findByRole('checkbox', { name: '角色' }));
    await userEvent.click(screen.getByTestId('export-submit'));
    await screen.findByTestId('export-progress');
    first.unmount();

    renderDialog(api);

    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Email' })).toBeChecked());
    expect(screen.getByRole('checkbox', { name: '角色' })).not.toBeChecked();
  });

  it('進行中可以取消，或關閉對話框在背景繼續', async () => {
    const running = transfer({ status: 'running', processedRows: 1, version: 4 });
    const cancel = vi.fn(async () => transfer({ status: 'cancelled' }));
    const api = fakeApi({
      createExport: vi.fn(async () => running),
      fetchTransfer: async () => running,
      cancel,
    });
    const { onOpenChange } = renderDialog(api, { matchingTotal: 3 });
    await userEvent.click(await screen.findByTestId('export-submit'));
    expect(await screen.findByText('正在匯出… 1／3')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('export-cancel'));
    expect(cancel).toHaveBeenCalledWith('t1', 4);

    await userEvent.click(screen.getByTestId('export-close'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('完成但沒有資料時不下載，顯示沒有符合的資料', async () => {
    const empty = transfer({ status: 'completed', totalRows: 0 });
    const download = vi.fn(async () => ({ url: '', fileName: '' }));
    renderDialog(
      fakeApi({
        createExport: vi.fn(async () => empty),
        fetchTransfer: async () => empty,
        download,
      }),
    );
    await userEvent.click(await screen.findByTestId('export-submit'));

    expect(await screen.findByTestId('export-empty')).toHaveTextContent('沒有符合的資料');
    expect(download).not.toHaveBeenCalled();
    expect(screen.getByTestId('export-close')).toHaveTextContent('關閉');
  });

  it('勾選的資料有些已無法存取時，說明匯出了幾筆', async () => {
    const partial = transfer({ status: 'completed', scopeKind: 'ids', totalRows: 1 });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderDialog(
      fakeApi({
        createExport: vi.fn(async () => partial),
        fetchTransfer: async () => partial,
        download: async () => new Promise(() => undefined),
      }),
      { selectedIds: ['u1', 'u2', 'u3'] },
    );
    await userEvent.click(await screen.findByTestId('export-submit'));

    expect(await screen.findByText('已勾選 3 筆，匯出 1 筆（2 筆已無法存取）')).toBeInTheDocument();
  });

  it('匯出失敗時顯示錯誤碼的訊息', async () => {
    const failed = transfer({ status: 'failed', errorCode: 'DATA_TRANSFER_NOT_FOUND' });
    renderDialog(
      fakeApi({ createExport: vi.fn(async () => failed), fetchTransfer: async () => failed }),
    );
    await userEvent.click(await screen.findByTestId('export-submit'));

    expect(await screen.findByText('找不到這筆匯入或匯出。')).toBeInTheDocument();
  });

  it('建立匯出失敗時留在表單並顯示錯誤', async () => {
    renderDialog(
      fakeApi({
        createExport: vi.fn(async () => {
          throw new AppError('DATA_TRANSFER_TYPE_UNSUPPORTED', 400);
        }),
      }),
    );
    await userEvent.click(await screen.findByTestId('export-submit'));

    expect(await screen.findByText('這種資料不支援這個匯入或匯出方式。')).toBeInTheDocument();
    expect(screen.getByTestId('export-submit')).toBeInTheDocument();
  });

  it('取得下載連結失敗時提示錯誤，對話框不關', async () => {
    const { onOpenChange } = renderDialog(
      fakeApi({
        download: async () => {
          throw new AppError('DATA_TRANSFER_NOT_FOUND', 404);
        },
      }),
    );
    await userEvent.click(await screen.findByTestId('export-submit'));

    expect(await screen.findByText('找不到這筆匯入或匯出。')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
