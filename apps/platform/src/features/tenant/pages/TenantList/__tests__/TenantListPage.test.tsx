import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';

import { registerTenantPagePermissions, Routes } from '../../..';
import { tenantFixture } from '../../../test-fixtures';

const { listTenants, createTenant, getTenant } = vi.hoisted(() => ({
  listTenants: vi.fn(),
  createTenant: vi.fn(),
  getTenant: vi.fn(),
}));
vi.mock('@/apis/platform-tenant/get-tenant-list/query', () => ({
  TENANT_LIST_QUERY_KEY: 'TENANT_LIST_QUERY_KEY',
  getTenantListQueryOptions: (params: Record<string, unknown>) => ({
    queryKey: ['TENANT_LIST_QUERY_KEY', params.offset, params.limit, params.q, params.status],
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
vi.mock('@/apis/platform-tenant/create-tenant/mutation', () => ({
  getCreateTenantMutationOptions: () => ({ mutationFn: createTenant }),
}));

const TENANT = tenantFixture();

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

beforeEach(() => {
  resetPagePermissionRegistry();
  registerTenantPagePermissions();
  listTenants.mockReset().mockResolvedValue({
    items: [TENANT],
    pagination: { offset: 0, limit: 50, total: 1 },
    baseDomain: 'localhost:5173',
  });
  getTenant.mockReset().mockResolvedValue(TENANT);
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

  it('預設第一頁、每頁 50 筆，不帶搜尋與篩選', async () => {
    renderPage(['tenant:read']);
    expect(await screen.findByTestId('tenant-link')).toBeInTheDocument();
    expect(listTenants).toHaveBeenCalledWith({
      offset: 0,
      limit: 50,
      q: undefined,
      status: undefined,
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
    listTenants.mockResolvedValue({
      items: [],
      pagination: { offset: 0, limit: 50, total: 0 },
      baseDomain: 'localhost:5173',
    });
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
      items: [TENANT],
      pagination: { offset: 0, limit: 50, total: 120 },
      baseDomain: 'localhost:5173',
    });
    const router = renderPage(['tenant:read']);
    expect(await screen.findByTestId('tenant-link')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('pagination-next'));
    await waitFor(() => expect(router.state.location.searchStr).toBe('?offset=50'));
  });
});
