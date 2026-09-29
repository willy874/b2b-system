import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { usePermissionStore } from '@/core/store';
import type { PlatformTenant } from '@/shared/api-sdk';
import { AllProviders } from '@/test/renderWithPermissions';

import { registerTenantPagePermissions, Routes } from '../../..';
import { tenantFixture } from '../../../test-fixtures';

const { getTenant, retry, disable, removeDomain } = vi.hoisted(() => ({
  getTenant: vi.fn(),
  retry: vi.fn(),
  disable: vi.fn(),
  removeDomain: vi.fn(),
}));
vi.mock('@/apis/platform-tenant/get-tenant/query', () => ({
  TENANT_DETAIL_QUERY_KEY: 'TENANT_DETAIL_QUERY_KEY',
  getTenantQueryOptions: (id: string) => ({
    queryKey: ['TENANT_DETAIL_QUERY_KEY', id],
    queryFn: () => getTenant(id),
  }),
}));
vi.mock('@/apis/platform-tenant/retry-tenant-provisioning/mutation', () => ({
  getRetryTenantProvisioningMutationOptions: () => ({ mutationFn: retry }),
}));
vi.mock('@/apis/platform-tenant/disable-tenant/mutation', () => ({
  getDisableTenantMutationOptions: () => ({ mutationFn: disable }),
}));
vi.mock('@/apis/platform-tenant/remove-tenant-domain/mutation', () => ({
  getRemoveTenantDomainMutationOptions: () => ({ mutationFn: removeDomain }),
}));

const ALL: PermissionKey[] = ['tenant:read', 'tenant:create', 'tenant:update', 'tenant:delete'];

function renderPage(tenant: PlatformTenant, permissions: PermissionKey[]) {
  getTenant.mockResolvedValue(tenant);
  usePermissionStore.setState({ permissions: new Set(permissions), hydrated: true });
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.TenantListRoute, Routes.TenantDetailRoute]),
    history: createMemoryHistory({ initialEntries: [`/tenant/${tenant.id}`] }),
    parseSearch,
    stringifySearch,
  });
  render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
}

beforeEach(() => {
  resetPagePermissionRegistry();
  registerTenantPagePermissions();
  getTenant.mockReset();
  retry.mockReset();
  disable.mockReset();
  removeDomain.mockReset();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('租戶詳情（docs/adr/0020-physical-tenant-isolation.md D12、D13）', () => {
  it('啟用中、全部權限 → 停用、刪除、改名、網域管理；主要網域排第一', async () => {
    renderPage(tenantFixture(), ALL);
    expect(await screen.findByTestId('tenant-disable')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-remove')).toBeInTheDocument();
    expect(screen.getByTestId('tenant-rename')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-enable')).toBeNull();
    expect(screen.queryByTestId('tenant-retry')).toBeNull();
    const domains = screen.getAllByTestId('tenant-domain').map((el) => el.dataset.value);
    expect(domains).toEqual(['acme.localhost:5173', 'portal.acme.test']);
    expect(screen.getByTestId('tenant-domain-input')).toBeInTheDocument();
  });

  it('只有 tenant:read → 沒有任何操作', async () => {
    renderPage(tenantFixture(), ['tenant:read']);
    expect(await screen.findByTestId('tenant-code')).toHaveTextContent('acme');
    for (const id of ['tenant-disable', 'tenant-remove', 'tenant-rename', 'tenant-domain-input']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.queryByTestId('tenant-domain-remove')).toBeNull();
  });

  it('佈建失敗 → 顯示原因與重試（需要 tenant:create）', async () => {
    const failed = tenantFixture({ status: 'failed', provisionError: 'connect ECONNREFUSED' });
    retry.mockResolvedValue({ ...failed, status: 'provisioning', provisionError: null });
    renderPage(failed, ALL);
    expect(await screen.findByTestId('tenant-provision-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('tenant-retry'));
    await waitFor(() => expect(retry).toHaveBeenCalled());
    expect(retry.mock.calls[0]?.[0]).toEqual({ params: { id: failed.id } });
  });

  it('佈建中 → 沒有停用與刪除', async () => {
    renderPage(tenantFixture({ status: 'provisioning', provisionedAt: null }), ALL);
    expect(await screen.findByTestId('tenant-provisioning')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-disable')).toBeNull();
    expect(screen.queryByTestId('tenant-remove')).toBeNull();
  });

  it('停用要先確認', async () => {
    const tenant = tenantFixture();
    disable.mockResolvedValue({ ...tenant, status: 'disabled' });
    renderPage(tenant, ALL);
    fireEvent.click(await screen.findByTestId('tenant-disable'));
    expect(disable).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(disable).toHaveBeenCalled());
    expect(disable.mock.calls[0]?.[0]).toEqual({ params: { id: tenant.id } });
  });

  it('只剩一個網域時不能移除', async () => {
    renderPage(tenantFixture({ domains: ['acme.localhost:5173'] }), ALL);
    expect(await screen.findByTestId('tenant-domain')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-domain-remove')).toBeNull();
  });
});
