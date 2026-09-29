import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { usePermissionStore } from '@/core/store';
import { AllProviders } from '@/test/renderWithPermissions';

import { registerIdentityProviderPagePermissions, Routes } from '../../..';

const { listProviders } = vi.hoisted(() => ({ listProviders: vi.fn() }));
vi.mock('@/apis/identity-provider/get-identity-provider-list/query', () => ({
  IDENTITY_PROVIDER_LIST_QUERY_KEY: 'IDENTITY_PROVIDER_LIST_QUERY_KEY',
  getIdentityProviderListQueryOptions: () => ({
    queryKey: ['IDENTITY_PROVIDER_LIST_QUERY_KEY'],
    queryFn: listProviders,
  }),
}));

const CALLBACK_URL = 'http://localhost:5175/api/oidc-interaction/external/callback';
const PROVIDER = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Acme Azure AD',
  issuer: 'https://login.acme.test',
  clientId: 'b2b',
  scopes: 'openid email profile',
  enabled: true,
  unmatchedPolicy: 'reject',
  domains: [{ domain: 'acme.test', ssoOnly: true }],
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
};

function renderPage(permissions: PermissionKey[] | 'unhydrated') {
  usePermissionStore.setState(
    permissions === 'unhydrated'
      ? { permissions: new Set(), hydrated: false, workspaceHydrated: false }
      : { permissions: new Set(permissions), hydrated: true, workspaceHydrated: true },
  );
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.IdentityProviderListRoute]),
    history: createMemoryHistory({ initialEntries: ['/identity-providers'] }),
    parseSearch,
    stringifySearch,
  });
  return render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
}

beforeEach(() => {
  resetPagePermissionRegistry();
  registerIdentityProviderPagePermissions();
  listProviders.mockReset().mockResolvedValue({ items: [PROVIDER], callbackUrl: CALLBACK_URL });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('外部 IdP 連線管理頁（docs/adr/0019-sso-identity-platform.md D8–D11）', () => {
  it('有 identityProvider:* → 顯示新增、編輯、刪除，以及要登記的 redirect URI', async () => {
    renderPage([
      'identityProvider:read',
      'identityProvider:create',
      'identityProvider:update',
      'identityProvider:delete',
    ] as PermissionKey[]);
    expect(await screen.findByTestId('identity-provider-edit')).toBeInTheDocument();
    expect(screen.getByTestId('identity-provider-create-button')).toBeInTheDocument();
    expect(screen.getByTestId('identity-provider-remove')).toBeInTheDocument();
    expect(screen.getByTestId('identity-provider-callback-url')).toHaveValue(CALLBACK_URL);
    expect(screen.getByTestId('identity-provider-domain')).toHaveAttribute(
      'data-value',
      'acme.test',
    );
  });

  it('只有 identityProvider:read → 看得到清單，沒有任何操作按鈕', async () => {
    renderPage(['identityProvider:read'] as PermissionKey[]);
    expect(await screen.findByTestId('identity-provider-domain')).toBeInTheDocument();
    await waitFor(() => expect(listProviders).toHaveBeenCalled());
    expect(screen.queryByTestId('identity-provider-create-button')).toBeNull();
    expect(screen.queryByTestId('identity-provider-edit')).toBeNull();
    expect(screen.queryByTestId('identity-provider-remove')).toBeNull();
  });

  it('權限未水合 → 不閃現操作按鈕', async () => {
    renderPage('unhydrated');
    expect(await screen.findByTestId('identity-provider-page')).toBeInTheDocument();
    expect(screen.queryByTestId('identity-provider-create-button')).toBeNull();
  });
});
