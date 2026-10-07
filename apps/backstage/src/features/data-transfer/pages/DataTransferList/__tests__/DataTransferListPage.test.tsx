import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { DATA_TRANSFER_FEATURE, registerDataTransferPagePermissions, Routes } from '../../..';

const { fetchList, fetchResources, download, deleteTransfer } = vi.hoisted(() => ({
  fetchList: vi.fn(),
  fetchResources: vi.fn(),
  download: vi.fn(),
  deleteTransfer: vi.fn(),
}));
vi.mock('@/apis/data-transfer/get-transfer-list/fetcher', () => ({
  fetchTransferListQuery: fetchList,
}));
vi.mock('@/apis/data-transfer/get-transfer-resources/fetcher', () => ({
  fetchTransferResourcesQuery: fetchResources,
}));
vi.mock('@/apis/data-transfer/download-transfer/fetcher', () => ({
  fetchDownloadTransferMutation: download,
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
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
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
});
