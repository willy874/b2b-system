import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { AllProviders } from '@/test/renderWithPermissions';

import { Routes } from '../../..';

function renderAt(url: string) {
  const router = createRouter({
    routeTree: RootRoute.addChildren([
      Routes.SsoErrorRoute,
      Routes.EnterTenantRoute,
      Routes.LoginRoute,
    ]),
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
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('provider 的協定錯誤頁（docs/adr/0019-sso-identity-platform.md D7）', () => {
  it('顯示錯誤並提供重新開始登入的出口（UX-28）', async () => {
    renderAt('/error?error=invalid_client');
    expect(await screen.findByTestId('sso-error')).toHaveAttribute('data-value', 'invalid_client');
    expect(screen.getByTestId('login-restart')).toHaveAttribute('href', '/enter');
    expect(screen.getByTestId('login-restart-platform')).toHaveAttribute('href', '/login');
  });
});
