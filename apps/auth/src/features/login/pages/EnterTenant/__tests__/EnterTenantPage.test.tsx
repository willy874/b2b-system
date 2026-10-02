import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/core/errors';
import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { AllProviders } from '@/test/renderWithPermissions';

import { Routes } from '../../..';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('@/apis/tenant/lookup-tenant/fetcher', () => ({ fetchTenantLookupQuery: lookup }));

const assign = vi.fn();

function renderAt(url: string) {
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.EnterTenantRoute]),
    history: createMemoryHistory({ initialEntries: [url] }),
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
  lookup.mockReset().mockResolvedValue({
    code: 'acme',
    name: 'Acme',
    loginUrl: 'http://acme.localhost:5173/auth/login',
  });
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('進入租戶（docs/architecture/05-tenancy.md §10.2 D11）', () => {
  it('輸入代碼 → 前往那個租戶的登入', async () => {
    renderAt('/enter');
    fireEvent.change(await screen.findByTestId('enter-tenant-code'), {
      target: { value: ' ACME ' },
    });
    fireEvent.click(screen.getByTestId('enter-tenant-submit'));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('http://acme.localhost:5173/auth/login'),
    );
    expect(lookup).toHaveBeenCalledWith({ params: { code: 'acme' } });
  });

  it('網址帶 ?tenant= → 直接前往', async () => {
    renderAt('/enter?tenant=acme');
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('http://acme.localhost:5173/auth/login'),
    );
  });

  it('找不到租戶 → 顯示錯誤、不跳轉', async () => {
    lookup.mockRejectedValue(new AppError('TENANT_NOT_FOUND', 404));
    renderAt('/enter');
    fireEvent.change(await screen.findByTestId('enter-tenant-code'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByTestId('enter-tenant-submit'));
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    // 失敗後按鈕恢復可按，可以改代碼再試
    await waitFor(() => expect(screen.getByTestId('enter-tenant-submit')).not.toBeDisabled());
    expect(assign).not.toHaveBeenCalled();
  });
});
