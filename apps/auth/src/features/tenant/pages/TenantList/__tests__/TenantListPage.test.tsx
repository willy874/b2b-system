import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { usePermissionStore } from '@/core/store';
import { AllProviders } from '@/test/renderWithPermissions';

import { registerTenantPagePermissions, Routes } from '../../..';
import { tenantFixture } from '../../../test-fixtures';

const { listTenants, createTenant, getTenant } = vi.hoisted(() => ({
  listTenants: vi.fn(),
  createTenant: vi.fn(),
  getTenant: vi.fn(),
}));
vi.mock('@/apis/platform-tenant/get-tenant-list/query', () => ({
  TENANT_LIST_QUERY_KEY: 'TENANT_LIST_QUERY_KEY',
  getTenantListQueryOptions: () => ({ queryKey: ['TENANT_LIST_QUERY_KEY'], queryFn: listTenants }),
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

function renderPage(permissions: PermissionKey[] | 'unhydrated') {
  usePermissionStore.setState(
    permissions === 'unhydrated'
      ? { permissions: new Set(), hydrated: false }
      : { permissions: new Set(permissions), hydrated: true },
  );
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.TenantListRoute, Routes.TenantDetailRoute]),
    history: createMemoryHistory({ initialEntries: ['/tenant'] }),
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

beforeEach(() => {
  resetPagePermissionRegistry();
  registerTenantPagePermissions();
  listTenants.mockReset().mockResolvedValue({ items: [TENANT], baseDomain: 'localhost:5173' });
  getTenant.mockReset().mockResolvedValue(TENANT);
  createTenant.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('租戶清單（docs/adr/0020-physical-tenant-isolation.md D12）', () => {
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
});
