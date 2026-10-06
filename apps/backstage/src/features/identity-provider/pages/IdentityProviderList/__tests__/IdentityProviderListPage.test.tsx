import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { usePermissionStore } from '@b2b-system/web-core/store';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';

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
      ? { permissions: new Set(), hydrated: false }
      : { permissions: new Set(permissions), hydrated: true },
  );
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.IdentityProviderListRoute]),
    history: createMemoryHistory({ initialEntries: ['/identity-provider'] }),
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
  listProviders.mockReset().mockResolvedValue({
    items: [PROVIDER],
    callbackUrl: CALLBACK_URL,
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('外部 IdP 連線管理頁（docs/architecture/04-sso.md §12.2 D8–D11）', () => {
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

  describe('表單對話框的未儲存提醒', () => {
    const MANAGER = [
      'identityProvider:read',
      'identityProvider:create',
      'identityProvider:update',
    ] as PermissionKey[];

    it('新增時輸入名稱後按 Esc：先確認；選「繼續編輯」後輸入還在', async () => {
      renderPage(MANAGER);
      fireEvent.click(await screen.findByTestId('identity-provider-create-button'));
      const input = await screen.findByTestId('identity-provider-name-input');
      fireEvent.change(input, { target: { value: 'Okta' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
      expect(screen.getByTestId('identity-provider-form-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('identity-provider-name-input')).toHaveValue('Okta');
    });

    it('新增時輸入名稱後按取消：選「放棄變更」才關閉', async () => {
      renderPage(MANAGER);
      fireEvent.click(await screen.findByTestId('identity-provider-create-button'));
      fireEvent.change(await screen.findByTestId('identity-provider-name-input'), {
        target: { value: 'Okta' },
      });
      fireEvent.click(screen.getByTestId('identity-provider-form-cancel'));

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
      await waitFor(() => expect(screen.queryByTestId('identity-provider-form-dialog')).toBeNull());
    });

    it('編輯時沒有改動按取消：直接關閉', async () => {
      renderPage(MANAGER);
      fireEvent.click(await screen.findByTestId('identity-provider-edit'));
      await screen.findByTestId('identity-provider-name-input');
      fireEvent.click(screen.getByTestId('identity-provider-form-cancel'));

      await waitFor(() => expect(screen.queryByTestId('identity-provider-form-dialog')).toBeNull());
      expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
    });
  });
});
