import { resetRouteLinkRegistry, routeLinkRegistry } from '@b2b-system/web-core/route-link';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { DATA_TRANSFER_FEATURE, registerDataTransferPagePermissions, Routes } from '../../..';

const { fetchList, fetchResources, download, deleteTransfer, cancelTransfer, fetchOne } =
  vi.hoisted(() => ({
    fetchOne: vi.fn(),
    cancelTransfer: vi.fn(),
    fetchList: vi.fn(),
    fetchResources: vi.fn(),
    download: vi.fn(),
    deleteTransfer: vi.fn(),
  }));
vi.mock('@/apis/data-transfer/get-transfer/fetcher', () => ({ fetchTransferQuery: fetchOne }));
vi.mock('@/apis/data-transfer/get-transfer-list/fetcher', () => ({
  fetchTransferListQuery: fetchList,
}));
vi.mock('@/apis/data-transfer/get-transfer-resources/fetcher', () => ({
  fetchTransferResourcesQuery: fetchResources,
}));
vi.mock('@/apis/data-transfer/download-transfer/fetcher', () => ({
  fetchDownloadTransferMutation: download,
}));
vi.mock('@/apis/data-transfer/cancel-transfer/fetcher', () => ({
  fetchCancelTransferMutation: cancelTransfer,
}));
vi.mock('@/apis/data-transfer/delete-transfer/fetcher', () => ({
  fetchDeleteTransferMutation: deleteTransfer,
}));

const EXPORTED = {
  id: '11111111-1111-4111-8111-111111111111',
  direction: 'export',
  type: 'user',
  mode: null,
  format: 'csv',
  status: 'completed',
  scopeKind: 'filter',
  columns: [],
  sourceName: null,
  outputName: 'users-20261008-1430.csv',
  outputSize: 120,
  totalRows: 12,
  processedRows: 12,
  succeededRows: 0,
  failedRows: 0,
  skippedRows: 0,
  errorCode: null,
  errorDetails: null,
  version: 2,
  expiresAt: '2026-10-15T06:30:00.000Z',
  startedAt: null,
  finishedAt: '2026-10-08T06:30:00.000Z',
  createdAt: '2026-10-08T06:30:00.000Z',
  updatedAt: '2026-10-08T06:30:00.000Z',
};
const routes = [Routes.DataTransferListRoute];

beforeAll(() => initTestI18n());

beforeEach(() => {
  resetPagePermissionRegistry();
  registerDataTransferPagePermissions();
  featureStore.setState({ resolved: true, statuses: new Map([[DATA_TRANSFER_FEATURE, 'ready']]) });
  fetchList
    .mockReset()
    .mockResolvedValue({ items: [EXPORTED], pagination: { offset: 0, limit: 20, total: 1 } });
  fetchResources.mockReset().mockResolvedValue({
    items: [{ type: 'user', label: '使用者', export: null, importModes: [] }],
  });
  download
    .mockReset()
    .mockResolvedValue({ url: 'https://files.test/x', fileName: 'users.csv', expiresAt: '' });
  deleteTransfer.mockReset().mockResolvedValue(undefined);
  cancelTransfer.mockReset().mockResolvedValue({ ...EXPORTED, status: 'cancelled' });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

const TYPES = ['user', 'role', 'group', 'groupMember', 'orgUnit', 'orgUnitMember', 'tag'];
const imported = (type: string, index: number) => ({
  ...EXPORTED,
  id: `00000000-0000-4000-8000-00000000000${index}`,
  direction: 'import',
  type,
  mode: index % 2 ? 'update' : null,
  outputName: null,
  sourceName: `${type}.csv`,
});

describe('我的匯入匯出（docs/architecture/backend/22-data-transfer.md §8.4）', () => {
  it('不需要任何權限：列出自己的傳輸，資源顯示名稱', async () => {
    renderRoute(routes, '/data-transfer', []);
    expect(
      await screen.findByText('users-20261008-1430.csv', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('使用者')).toBeInTheDocument();
    expect(screen.getByTestId('data-transfer-status')).toHaveAttribute('data-value', 'completed');
  });

  it('完成的匯出可以下載：每次重新取得連結', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    renderRoute(routes, '/data-transfer', []);
    fireEvent.click(
      await screen.findByTestId('data-transfer-download', undefined, { timeout: 5000 }),
    );
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(download).toHaveBeenCalledWith({ params: { transferId: EXPORTED.id } });
    click.mockRestore();
  });

  it('權限未水合時也不需要等（頁面沒有權限要求）', async () => {
    renderRoute(routes, '/data-transfer', 'unhydrated');
    expect(
      await screen.findByTestId('data-transfer-page', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('進行中的傳輸可以取消：確認後帶上版本', async () => {
    fetchList.mockResolvedValue({
      items: [{ ...EXPORTED, status: 'running', version: 4 }],
      pagination: { offset: 0, limit: 20, total: 1 },
    });
    renderRoute(routes, '/data-transfer', []);
    fireEvent.click(
      await screen.findByTestId('data-transfer-cancel', undefined, { timeout: 5000 }),
    );
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));
    await waitFor(() =>
      expect(cancelTransfer).toHaveBeenCalledWith({
        params: { transferId: EXPORTED.id, version: 4 },
      }),
    );
  });

  it('結束的傳輸可以刪除：確認後呼叫刪除', async () => {
    renderRoute(routes, '/data-transfer', []);
    fireEvent.click(
      await screen.findByTestId('data-transfer-delete', undefined, { timeout: 5000 }),
    );
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));
    await waitFor(() =>
      expect(deleteTransfer).toHaveBeenCalledWith({ params: { transferId: EXPORTED.id } }),
    );
  });

  it('網址帶 offset → 以它查詢', async () => {
    fetchList.mockResolvedValue({
      items: [EXPORTED],
      pagination: { offset: 20, limit: 20, total: 45 },
    });
    renderRoute(routes, '/data-transfer?offset=20', []);
    await screen.findByText('users-20261008-1430.csv', undefined, { timeout: 5000 });
    expect(fetchList).toHaveBeenLastCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ offset: 20, limit: 20 }) }),
    );
    fireEvent.click(screen.getByTestId('pagination-prev'));
    await waitFor(() =>
      expect(fetchList).toHaveBeenLastCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ offset: 0 }) }),
      ),
    );
  });

  it('從通知點進來（?transfer=）：那一筆列在上方可以下載；關掉後網址拿掉 transfer', async () => {
    const OLD = { ...EXPORTED, id: '22222222-2222-4222-8222-222222222222', outputName: 'old.csv' };
    fetchOne.mockResolvedValue(OLD);
    const { router } = renderRoute(routes, `/data-transfer?transfer=${OLD.id}`, []);
    const highlight = await screen.findByTestId('data-transfer-highlight', undefined, {
      timeout: 5000,
    });
    expect(await within(highlight).findByText('old.csv')).toBeInTheDocument();
    expect(fetchOne).toHaveBeenCalledWith(
      expect.objectContaining({ params: { transferId: OLD.id } }),
    );

    fireEvent.click(within(highlight).getByTestId('data-transfer-highlight-close'));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('transfer'));
    expect(screen.queryByTestId('data-transfer-highlight')).toBeNull();
  });

  describe('匯入完成的「查看結果」', () => {
    afterEach(() => resetRouteLinkRegistry());

    it('各資源連到自己的匯入頁；那個 feature 沒有登記 route id 時不顯示', async () => {
      for (const resource of TYPES.filter((item) => item !== 'tag')) {
        routeLinkRegistry.register(`${resource}.import`, {
          path: '/data-transfer',
          params: {},
          search: {},
        });
      }
      fetchList.mockResolvedValue({
        items: [...TYPES, 'unknown'].map(imported),
        pagination: { offset: 0, limit: 20, total: 8 },
      });
      renderRoute(routes, '/data-transfer', []);
      await screen.findByText('user.csv', undefined, { timeout: 5000 });

      const links = await screen.findAllByTestId('data-transfer-result');
      expect(links.map((link) => link.getAttribute('data-value'))).toEqual(
        TYPES.slice(0, 6).map((_, index) => imported('x', index).id),
      );
      expect(links[0]).toHaveTextContent('查看結果');
    });
  });
});
