import { AppError } from '@b2b-system/web-core/errors';
import { parseSearch, RootRoute, stringifySearch } from '@b2b-system/web-core/router';
import { AllProviders } from '@b2b-system/web-core/testing';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { Routes } from '../../..';

const { register, publicSettings } = vi.hoisted(() => ({
  register: vi.fn(),
  publicSettings: vi.fn(),
}));
vi.mock('@/apis/auth/register/mutation', () => ({
  getRegisterMutationOptions: () => ({ mutationFn: register }),
}));
vi.mock('@/apis/auth/get-public-settings/query', () => ({
  PUBLIC_SETTINGS_QUERY_KEY: 'PUBLIC_SETTINGS_QUERY_KEY',
  getPublicSettingsQueryOptions: (tenant: string) => ({
    queryKey: ['PUBLIC_SETTINGS_QUERY_KEY', tenant],
    queryFn: () => publicSettings(tenant),
  }),
}));

function renderAt(url: string) {
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.RegisterRoute]),
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

async function fillAndSubmit() {
  fireEvent.change(await screen.findByTestId('register-email'), {
    target: { value: 'alice@example.com' },
  });
  fireEvent.change(screen.getByTestId('register-display-name'), { target: { value: 'Alice' } });
  fireEvent.click(screen.getByTestId('register-submit'));
}

beforeEach(() => {
  register.mockReset().mockResolvedValue({ submitted: true });
  publicSettings.mockReset().mockResolvedValue({
    values: { 'auth.passwordMinLength': 12, 'auth.registrationEnabled': true },
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

// 錯誤訊息要是真的翻譯，才能斷言 role="alert" 裡的文字
beforeAll(() => initTestI18n());

describe('申請帳號頁（docs/rbac/06-approval.md §5）', () => {
  it('不要求密碼（由核准後的啟用信設定）；送出後顯示「已送出」', async () => {
    renderAt('/register?tenant=acme');
    expect(await screen.findByTestId('register-email')).toBeInTheDocument();
    expect(screen.queryByTestId('register-password')).not.toBeInTheDocument();
    await fillAndSubmit();
    await waitFor(() => expect(register).toHaveBeenCalled());
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      params: { tenant: 'acme', email: 'alice@example.com', displayName: 'Alice' },
    });
    expect(await screen.findByTestId('register-submitted')).toBeInTheDocument();
  });

  it('送出失敗 → 錯誤訊息在 role="alert" 裡（docs/architecture/frontend/07-ui-system.md §5）', async () => {
    register.mockRejectedValue(new AppError('RATE_LIMITED', 429));
    renderAt('/register?tenant=acme');
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByRole('alert')).not.toBeEmptyDOMElement());
    expect(screen.getByRole('alert')).toHaveTextContent('操作太頻繁');
    expect(screen.queryByTestId('register-submitted')).not.toBeInTheDocument();
  });

  it('租戶關閉了註冊 → 不顯示表單', async () => {
    publicSettings.mockResolvedValue({ values: { 'auth.registrationEnabled': false } });
    renderAt('/register?tenant=acme');
    expect(await screen.findByTestId('register-closed')).toBeInTheDocument();
    expect(screen.queryByTestId('register-email')).not.toBeInTheDocument();
  });
});
