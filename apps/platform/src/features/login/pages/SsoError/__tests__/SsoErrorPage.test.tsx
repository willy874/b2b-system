import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('provider 的協定錯誤頁（docs/architecture/04-sso.md §12.2 D7）', () => {
  it('顯示錯誤並提供重新開始登入的出口', async () => {
    renderAt('/error?error=invalid_client');
    expect(await screen.findByTestId('sso-error')).toHaveAttribute('data-value', 'invalid_client');
    expect(screen.getByTestId('login-restart')).toHaveAttribute('href', '/enter');
    expect(screen.getByTestId('login-restart-platform')).toHaveAttribute('href', '/login');
  });
});
