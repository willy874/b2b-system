import { AppError } from '@b2b-system/web-core/errors';
import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerTenantPagePermissions, Routes } from '../../..';
import {
  emptyUsageSummary,
  tenantFixture,
  tenantListItemFixture,
  usageSummaryFixture,
} from '../../../test-fixtures';

const { listTenants, createTenant, getTenant, getStorageTotal } = vi.hoisted(() => ({
  listTenants: vi.fn(),
  createTenant: vi.fn(),
  getTenant: vi.fn(),
  getStorageTotal: vi.fn(),
}));
vi.mock('@/apis/platform-tenant/get-tenant-list/query', () => ({
  TENANT_LIST_QUERY_KEY: 'TENANT_LIST_QUERY_KEY',
  getTenantListQueryOptions: (params: Record<string, unknown>) => ({
    queryKey: [
      'TENANT_LIST_QUERY_KEY',
      params.offset,
      params.limit,
      params.q,
      params.status,
      JSON.stringify(params.sort),
    ],
    queryFn: () => listTenants(params),
  }),
}));
vi.mock('@/apis/platform-tenant/get-tenant/query', () => ({
  TENANT_DETAIL_QUERY_KEY: 'TENANT_DETAIL_QUERY_KEY',
  getTenantQueryOptions: (id: string) => ({
    queryKey: ['TENANT_DETAIL_QUERY_KEY', id],
    queryFn: () => getTenant(id),
  }),
}));
vi.mock('@/apis/platform-tenant/get-storage-total/query', () => ({
  STORAGE_TOTAL_QUERY_KEY: 'STORAGE_TOTAL_QUERY_KEY',
  getStorageTotalQueryOptions: () => ({
    queryKey: ['STORAGE_TOTAL_QUERY_KEY'],
    queryFn: () => getStorageTotal(),
  }),
}));
vi.mock('@/apis/platform-tenant/create-tenant/mutation', () => ({
  getCreateTenantMutationOptions: () => ({ mutationFn: createTenant }),
}));

const TENANT = tenantFixture();

function listOf(...items: ReturnType<typeof tenantListItemFixture>[]) {
  return {
    items,
    pagination: { offset: 0, limit: 50, total: items.length },
    baseDomain: 'localhost:5173',
    usageRecentDays: 7,
    usageWarningRatio: 0.8,
  };
}

const GIB = 1024 ** 3;

/** 儲存的止水線；`limitBytes: null` 是部署沒有啟用。 */
function storageTotalOf(limitBytes: number | null, usedBytes: number, isStale = false) {
  return {
    usedBytes,
    limitBytes,
    usageRatio: limitBytes === null ? null : usedBytes / limitBytes,
    warningRatio: 0.8,
    measuredAt: '2026-10-09T12:00:00.000Z',
    isStale,
  };
}

function renderPage(permissions: PermissionKey[] | 'unhydrated', url = '/tenant') {
  usePermissionStore.setState(
    permissions === 'unhydrated'
      ? { permissions: new Set(), hydrated: false }
      : { permissions: new Set(permissions), hydrated: true },
  );
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.TenantListRoute, Routes.TenantDetailRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
    parseSearch,
    stringifySearch,
  });
  render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
  return router;
}

// 頁面是 lazy 載入：先載好，第一個測試才不會在機器忙碌時等超過 findBy 的逾時
beforeAll(async () => {
  await import('../page');
});

// 錯誤訊息要是真的翻譯，才能斷言 role="alert" 裡的文字
beforeAll(() => initTestI18n());

beforeEach(() => {
  resetPagePermissionRegistry();
  registerTenantPagePermissions();
  listTenants.mockReset().mockResolvedValue(listOf(tenantListItemFixture()));
  getTenant.mockReset().mockResolvedValue(TENANT);
  getStorageTotal.mockReset().mockResolvedValue(storageTotalOf(null, 0));
  createTenant.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('租戶清單（docs/architecture/05-tenancy.md §10.2 D12）', () => {
  it('有 tenant:create → 顯示建立按鈕與清單', async () => {
    renderPage(['tenant:read', 'tenant:create']);
    expect(await screen.findByTestId('tenant-link')).toHaveAttribute('data-value', 'acme');
    expect(screen.getByTestId('tenant-status')).toHaveAttribute('data-value', 'active');
    expect(screen.getByTestId('tenant-create-button')).toBeInTheDocument();
  });

  it('只有 tenant:read → 看得到清單，沒有建立按鈕', async () => {
    renderPage(['tenant:read']);
    expect(await screen.findByTestId('tenant-link')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-create-button')).toBeNull();
  });

  it('權限未水合 → 不閃現建立按鈕', async () => {
    renderPage('unhydrated');
    expect(await screen.findByTestId('tenant-page')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-create-button')).toBeNull();
  });

  it('建立：檢查代碼格式；送出後進入新租戶的詳情', async () => {
    const created = tenantFixture({
      id: '55555555-5555-4555-8555-555555555555',
      code: 'beta',
      status: 'provisioning',
    });
    createTenant.mockResolvedValue(created);
    getTenant.mockResolvedValue(created);
    const router = renderPage(['tenant:read', 'tenant:create']);
    fireEvent.click(await screen.findByTestId('tenant-create-button'));

    fireEvent.change(screen.getByTestId('tenant-code-input'), { target: { value: 'Auth' } });
    fireEvent.change(screen.getByTestId('tenant-name-input'), { target: { value: 'Beta' } });
    fireEvent.change(screen.getByTestId('tenant-admin-email-input'), {
      target: { value: 'owner@beta.test' },
    });
    fireEvent.click(screen.getByTestId('tenant-create-submit'));
    // 保留字：前端就擋下，不送出
    await waitFor(() => expect(screen.getByTestId('tenant-create-submit')).not.toBeDisabled());
    expect(createTenant).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('tenant-code-input'), { target: { value: 'Beta' } });
    fireEvent.click(screen.getByTestId('tenant-create-submit'));
    await waitFor(() => expect(createTenant).toHaveBeenCalled());
    expect(createTenant.mock.calls[0]?.[0]).toEqual({
      params: {
        code: 'beta',
        name: 'Beta',
        adminEmail: 'owner@beta.test',
        adminName: undefined,
        domains: [],
      },
    });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/tenant/${created.id}`));
  });

  it('建立失敗 → 錯誤訊息在 role="alert" 裡，對話框不關閉（docs/architecture/frontend/07-ui-system.md §5）', async () => {
    createTenant.mockRejectedValue(new AppError('INTERNAL_ERROR', 500));
    renderPage(['tenant:read', 'tenant:create']);
    fireEvent.click(await screen.findByTestId('tenant-create-button'));
    fireEvent.change(screen.getByTestId('tenant-code-input'), { target: { value: 'beta' } });
    fireEvent.change(screen.getByTestId('tenant-name-input'), { target: { value: 'Beta' } });
    fireEvent.change(screen.getByTestId('tenant-admin-email-input'), {
      target: { value: 'owner@beta.test' },
    });
    fireEvent.click(screen.getByTestId('tenant-create-submit'));

    await waitFor(() => expect(createTenant).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('伺服器發生錯誤'));
    expect(screen.getByRole('alert')).toHaveAttribute('data-testid', 'tenant-create-error');
  });

  it('預設第一頁、每頁 50 筆，不帶搜尋與篩選', async () => {
    renderPage(['tenant:read']);
    expect(await screen.findByTestId('tenant-link')).toBeInTheDocument();
    expect(listTenants).toHaveBeenCalledWith({
      offset: 0,
      limit: 50,
      q: undefined,
      status: undefined,
      sort: [],
    });
  });

  it('網址上的條件（重新整理後）直接套用到查詢，並列出套用中的狀態篩選', async () => {
    renderPage(['tenant:read'], '/tenant?status=failed&q=acme&offset=25&limit=25');
    await waitFor(() =>
      expect(listTenants).toHaveBeenCalledWith({
        offset: 25,
        limit: 25,
        q: 'acme',
        status: 'failed',
        sort: [],
      }),
    );
    expect(screen.getByTestId('table-search')).toHaveValue('acme');
    expect(screen.getByTestId('active-filter')).toHaveAttribute('data-value', 'status');
  });

  it('搜尋：Enter 寫進網址並回到第一頁；清空後拿掉條件', async () => {
    const router = renderPage(['tenant:read'], '/tenant?offset=50');
    const input = await screen.findByTestId('table-search');
    fireEvent.change(input, { target: { value: ' portal ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'portal' }));
    await waitFor(() =>
      expect(listTenants).toHaveBeenLastCalledWith({
        offset: 0,
        limit: 50,
        q: 'portal',
        status: undefined,
        sort: [],
      }),
    );

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('移除狀態篩選：保留關鍵字並回到第一頁', async () => {
    const router = renderPage(['tenant:read'], '/tenant?status=failed&q=acme&offset=50');
    fireEvent.click(await screen.findByTestId('active-filter-remove'));
    await waitFor(() => expect(router.state.location.search).toEqual({ q: 'acme' }));
  });

  it('有條件但沒有結果 → 說明沒有符合條件的租戶，可以清除條件', async () => {
    listTenants.mockResolvedValue(listOf());
    const router = renderPage(['tenant:read'], '/tenant?status=failed&q=zzz');
    fireEvent.click(await screen.findByTestId('rich-table-clear-filters'));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
  });

  it('查詢失敗 → 顯示錯誤與重試，而不是「還沒有任何租戶」', async () => {
    listTenants.mockRejectedValue(new Error('boom'));
    renderPage(['tenant:read']);
    expect(await screen.findByTestId('rich-table-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('query-error-retry'));
    await waitFor(() => expect(listTenants).toHaveBeenCalledTimes(2));
  });

  it('分頁：下一頁帶 offset', async () => {
    listTenants.mockResolvedValue({
      ...listOf(tenantListItemFixture()),
      pagination: { offset: 0, limit: 50, total: 120 },
    });
    const router = renderPage(['tenant:read']);
    expect(await screen.findByTestId('tenant-link')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('pagination-next'));
    await waitFor(() => expect(router.state.location.searchStr).toBe('?offset=50'));
  });
});

describe('租戶清單的用量（docs/architecture/05-tenancy.md §5.4）', () => {
  it('每列顯示啟用的使用者、儲存使用率、近期請求；還沒彙總過的租戶顯示「-」', async () => {
    listTenants.mockResolvedValue(
      listOf(
        tenantListItemFixture(),
        tenantListItemFixture(
          { id: '55555555-5555-4555-8555-555555555555', code: 'beta' },
          emptyUsageSummary(),
        ),
      ),
    );
    renderPage(['tenant:read']);
    const [acme, beta] = await screen.findAllByTestId('table-row');
    expect(acme).toHaveTextContent('12');
    expect(acme).toHaveTextContent('512.0 MB (25%)');
    expect(acme).toHaveTextContent('4,321');
    expect(beta).not.toHaveTextContent('MB');
    expect(screen.getAllByTestId('tenant-storage-usage')).toHaveLength(1);
  });

  it('使用率達到警示門檻 → 以警示標出', async () => {
    listTenants.mockResolvedValue(listOf(tenantListItemFixture({}, usageSummaryFixture({}, 0.85))));
    renderPage(['tenant:read']);
    expect(await screen.findByTestId('tenant-storage-usage')).toHaveAttribute(
      'data-value',
      'warning',
    );
  });

  it('點表頭排序：寫進網址、帶進查詢並回到第一頁', async () => {
    const router = renderPage(['tenant:read'], '/tenant?offset=50');
    await screen.findByTestId('tenant-link');
    fireEvent.click(screen.getByRole('button', { name: /tenant\.field\.storage|儲存空間/ }));
    // offset 回到 0（預設值不寫進網址）；網址上是排序的 token
    await waitFor(() => expect(router.state.location.searchStr).toBe('?sort=storageUsage'));
    await waitFor(() =>
      expect(listTenants).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 0, sort: [{ sort: 'storageUsage', order: 'asc' }] }),
      ),
    );
  });

  it('網址帶排序（重新整理後）→ 直接套用到查詢', async () => {
    renderPage(['tenant:read'], '/tenant?sort=-lastActivityAt');
    await waitFor(() =>
      expect(listTenants).toHaveBeenCalledWith(
        expect.objectContaining({ sort: [{ sort: 'lastActivityAt', order: 'desc' }] }),
      ),
    );
  });
});

describe('租戶清單的儲存止水線（docs/architecture/backend/25-image.md §12）', () => {
  it('部署沒有啟用：不顯示', async () => {
    renderPage(['tenant:read']);
    expect(await screen.findByTestId('tenant-link')).toBeInTheDocument();
    await waitFor(() => expect(getStorageTotal).toHaveBeenCalled());
    expect(screen.queryByTestId('tenant-storage-total')).toBeNull();
  });

  it('未達警示：顯示用量，沒有警告', async () => {
    getStorageTotal.mockResolvedValue(storageTotalOf(100 * GIB, 25 * GIB));
    renderPage(['tenant:read']);
    expect(await screen.findByTestId('tenant-storage-total-progress')).toHaveAttribute(
      'data-value',
      'normal',
    );
    expect(screen.queryByTestId('tenant-storage-total-warning')).toBeNull();
  });

  it('越過 80%：警告；到 100%：改成「已達止水線」', async () => {
    getStorageTotal.mockResolvedValue(storageTotalOf(100 * GIB, 85 * GIB));
    renderPage(['tenant:read']);
    expect(await screen.findByTestId('tenant-storage-total-warning')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-storage-total-progress')).toHaveAttribute(
      'data-value',
      'warning',
    );
  });

  it('已達止水線、彙總過舊：各自顯示說明', async () => {
    getStorageTotal.mockResolvedValue(storageTotalOf(100 * GIB, 120 * GIB, true));
    renderPage(['tenant:read']);
    expect(await screen.findByTestId('tenant-storage-total-reached')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-storage-total-warning')).toBeNull();
    expect(screen.getByTestId('tenant-storage-total-stale')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-storage-total-progress')).toHaveAttribute(
      'data-value',
      'reached',
    );
  });
});
