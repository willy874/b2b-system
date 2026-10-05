import { NetworkError } from '@b2b-system/web-core/client';
import { AppError } from '@b2b-system/web-core/errors';
import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('忘記密碼頁（帳號屬於租戶，docs/architecture/05-tenancy.md §10.2 D26）', () => {
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

  it.each([
    ['限流（429）', new AppError('RATE_LIMITED', 429)],
    ['租戶無法使用（503）', new AppError('TENANT_UNAVAILABLE', 503)],
    ['網路錯誤', new NetworkError(new TypeError('Failed to fetch'))],
  ])('%s → 顯示錯誤，不顯示「已寄出」', async (_label, error) => {
    forgot.mockRejectedValue(error);
    renderAt('/forgot-password?tenant=acme');
    fireEvent.change(await screen.findByTestId('forgot-password-email'), {
      target: { value: 'alice@example.com' },
    });
    fireEvent.click(screen.getByTestId('forgot-password-submit'));
    expect(await screen.findByTestId('forgot-password-error')).toBeInTheDocument();
    expect(screen.queryByTestId('forgot-password-sent')).toBeNull();
    // 表單留著，可以再送一次
    expect(screen.getByTestId('forgot-password-submit')).toBeInTheDocument();
  });
});
