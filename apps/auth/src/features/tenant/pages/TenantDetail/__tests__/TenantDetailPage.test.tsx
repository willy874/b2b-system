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

const { getTenant, retry, disable, removeDomain, update, removeTenant } = vi.hoisted(() => ({
  update: vi.fn(),
  removeTenant: vi.fn(),
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
vi.mock('@/apis/platform-tenant/update-tenant/mutation', () => ({
  getUpdateTenantMutationOptions: () => ({ mutationFn: update }),
}));
vi.mock('@/apis/platform-tenant/delete-tenant/mutation', () => ({
  getDeleteTenantMutationOptions: () => ({ mutationFn: removeTenant }),
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
  return router;
}

beforeEach(() => {
  resetPagePermissionRegistry();
  registerTenantPagePermissions();
  getTenant.mockReset();
  retry.mockReset();
  disable.mockReset();
  removeDomain.mockReset();
  update.mockReset();
  removeTenant.mockReset();
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

  it('外部 IdP 開關：打開直接送出 allowExternalIdp', async () => {
    const tenant = tenantFixture({ allowExternalIdp: false });
    update.mockResolvedValue({ ...tenant, allowExternalIdp: true });
    renderPage(tenant, ALL);
    const toggle = await screen.findByTestId('tenant-allow-external-idp');
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, body: { allowExternalIdp: true } },
    });
    expect(screen.queryByTestId('tenant-external-idp-dialog')).toBeNull();
  });

  it('外部 IdP 開關：關閉要先確認影響（UX-15），取消就不送出', async () => {
    const tenant = tenantFixture();
    update.mockResolvedValue({ ...tenant, allowExternalIdp: false });
    renderPage(tenant, ALL);
    const toggle = await screen.findByTestId('tenant-allow-external-idp');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(toggle);
    expect(await screen.findByTestId('tenant-external-idp-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('tenant-external-idp-dialog')).toBeNull());
    expect(update).not.toHaveBeenCalled();

    fireEvent.click(toggle);
    fireEvent.click(await screen.findByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, body: { allowExternalIdp: false } },
    });
  });

  it('外部 IdP 開關：只有 tenant:read → 不能切換', async () => {
    renderPage(tenantFixture(), ['tenant:read']);
    expect(await screen.findByTestId('tenant-allow-external-idp')).toHaveAttribute('data-disabled');
  });

  it('佈建完成但後續步驟失敗 → 顯示提醒（不是佈建失敗），沒有重試', async () => {
    renderPage(tenantFixture({ provisionError: 'storageBucket: FILE_STORAGE_UNAVAILABLE' }), ALL);
    expect(await screen.findByTestId('tenant-provision-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('tenant-provision-error')).toBeNull();
    expect(screen.queryByTestId('tenant-retry')).toBeNull();
  });

  it('主要網域沒有移除鈕；其他網域移除前要確認（UX-01），取消後網域還在', async () => {
    renderPage(tenantFixture(), ALL);
    expect(await screen.findByTestId('tenant-domain-primary')).toBeInTheDocument();
    const removeButtons = screen.getAllByTestId('tenant-domain-remove');
    expect(removeButtons.map((el) => el.dataset.value)).toEqual(['portal.acme.test']);

    fireEvent.click(removeButtons[0]!);
    expect(await screen.findByTestId('tenant-domain-remove-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('alert-dialog-cancel'));
    await waitFor(() => expect(screen.queryByTestId('tenant-domain-remove-dialog')).toBeNull());
    expect(removeDomain).not.toHaveBeenCalled();
  });

  it('確認移除網域：送出中兩顆按鈕都停用，不會重複送出', async () => {
    const tenant = tenantFixture();
    let finish: (value: unknown) => void = () => undefined;
    removeDomain.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderPage(tenant, ALL);
    fireEvent.click(await screen.findByTestId('tenant-domain-remove'));
    const confirmButton = await screen.findByTestId('alert-dialog-confirm');
    fireEvent.click(confirmButton);
    // loading 的按鈕用 aria-disabled（保留焦點），取消鈕是原生 disabled
    await waitFor(() => expect(confirmButton).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByTestId('alert-dialog-cancel')).toBeDisabled();
    fireEvent.click(confirmButton);
    expect(removeDomain).toHaveBeenCalledTimes(1);
    expect(removeDomain.mock.calls[0]?.[0]).toEqual({
      params: { id: tenant.id, domain: 'portal.acme.test' },
    });
    finish({ ...tenant, domains: ['acme.localhost:5173'] });
    await waitFor(() => expect(screen.queryByTestId('tenant-domain-remove-dialog')).toBeNull());
  });

  it('刪除租戶要輸入租戶代碼才能確認（UX-15）', async () => {
    const tenant = tenantFixture();
    removeTenant.mockResolvedValue(undefined);
    const router = renderPage(tenant, ALL);
    fireEvent.click(await screen.findByTestId('tenant-remove'));
    const submit = await screen.findByTestId('tenant-remove-submit');
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId('tenant-remove-confirm-input'), {
      target: { value: 'acm' },
    });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(removeTenant).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('tenant-remove-confirm-input'), {
      target: { value: 'acme' },
    });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);
    await waitFor(() => expect(removeTenant).toHaveBeenCalled());
    expect(removeTenant.mock.calls[0]?.[0]).toEqual({ params: { id: tenant.id } });
    // 刪除後回到清單
    await waitFor(() => expect(router.state.location.pathname).toBe('/tenant'));
    await waitFor(() => expect(router.state.status).toBe('idle'));
  });
});
