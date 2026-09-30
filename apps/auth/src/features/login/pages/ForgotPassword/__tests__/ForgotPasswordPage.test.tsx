import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseSearch, RootRoute, stringifySearch } from '@/core/router';
import { AllProviders } from '@/test/renderWithPermissions';

import { Routes } from '../../..';

const { forgot } = vi.hoisted(() => ({ forgot: vi.fn() }));
vi.mock('@/apis/auth/forgot-password/mutation', () => ({
  getForgotPasswordMutationOptions: () => ({ mutationFn: forgot }),
}));

function renderAt(url: string) {
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.ForgotPasswordRoute]),
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
  forgot.mockReset().mockResolvedValue({ sent: true });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('忘記密碼頁（帳號屬於租戶，docs/adr/0020-physical-tenant-isolation.md D26）', () => {
  it('網址沒有 ?tenant= → 不知道是哪個租戶的帳號，不顯示表單', async () => {
    renderAt('/forgot-password');
    expect(await screen.findByTestId('tenant-required')).toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password-email')).not.toBeInTheDocument();
  });

  it('帶著網址的租戶送出', async () => {
    renderAt('/forgot-password?tenant=acme');
    fireEvent.change(await screen.findByTestId('forgot-password-email'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.click(screen.getByTestId('forgot-password-submit'));
    await waitFor(() => expect(forgot).toHaveBeenCalled());
    expect(forgot.mock.calls[0]?.[0]).toMatchObject({
      params: { tenant: 'acme', email: 'alice@example.com' },
    });
    expect(await screen.findByTestId('forgot-password-sent')).toBeInTheDocument();
  });
});
