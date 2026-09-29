import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RootRoute } from '@/core/router';
import { AllProviders } from '@/test/renderWithPermissions';

import { Routes } from '../../..';

const { details, login, abort } = vi.hoisted(() => ({
  details: vi.fn(),
  login: vi.fn(),
  abort: vi.fn(),
}));

vi.mock('@/apis/sso-interaction/get-sso-interaction/query', () => ({
  SSO_INTERACTION_QUERY_KEY: 'SSO_INTERACTION_QUERY_KEY',
  getSsoInteractionQueryOptions: (uid: string) => ({
    queryKey: ['SSO_INTERACTION_QUERY_KEY', uid],
    queryFn: details,
    retry: false,
  }),
}));
vi.mock('@/apis/sso-interaction/login-sso-interaction/mutation', () => ({
  getLoginSsoInteractionMutationOptions: () => ({ mutationFn: login }),
}));
vi.mock('@/apis/sso-interaction/abort-sso-interaction/mutation', () => ({
  getAbortSsoInteractionMutationOptions: () => ({ mutationFn: abort }),
}));

const UID = 'abc12345xyz';
const RESUME = `http://localhost:5175/api/oidc/auth/${UID}`;
const assign = vi.fn();

function renderInteraction() {
  const router = createRouter({
    routeTree: RootRoute.addChildren([Routes.InteractionRoute]),
    history: createMemoryHistory({ initialEntries: [`/interaction/${UID}`] }),
  });
  return render(
    <AllProviders>
      <RouterProvider router={router} />
    </AllProviders>,
  );
}

beforeEach(() => {
  details.mockReset().mockResolvedValue({
    uid: UID,
    prompt: 'login',
    clientId: 'backstage',
    clientName: 'backstage',
    loginHint: null,
  });
  login.mockReset().mockResolvedValue({ redirectTo: RESUME });
  abort.mockReset().mockResolvedValue({ redirectTo: `${RESUME}?aborted` });
  assign.mockReset();
  // 頂層跳轉：jsdom 的 location.assign 不能 spy，整個換掉（router 用 memory history，不受影響）
  vi.stubGlobal('location', { ...window.location, assign });
  // router 換頁後會捲回頂端；jsdom 沒有實作 scrollTo
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('IdP 的登入互動頁（docs/adr/0019-sso-identity-platform.md）', () => {
  it('登入成功 → 以互動 id 送出帳密，並頂層跳轉到 resume 網址', async () => {
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'secret-123' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(assign).toHaveBeenCalledWith(RESUME));
    expect(login.mock.calls[0]?.[0]).toEqual({
      params: { uid: UID, email: 'user@example.com', password: 'secret-123' },
    });
  });

  it('帳密錯誤時顯示錯誤、不跳轉', async () => {
    login.mockRejectedValue(new Error('AUTH_INVALID_CREDENTIALS'));
    renderInteraction();
    fireEvent.change(await screen.findByTestId('login-email'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'wrong' } });
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(login).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('login-submit')).not.toBeDisabled());
    expect(assign).not.toHaveBeenCalled();
  });

  it('取消 → 頂層跳轉到 provider（產品收到 access_denied）', async () => {
    renderInteraction();
    await waitFor(() => expect(screen.getByTestId('login-cancel')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-cancel'));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(`${RESUME}?aborted`));
    expect(abort.mock.calls[0]?.[0]).toEqual({ params: { uid: UID } });
  });

  it('互動無效（過期、沒有互動 cookie）→ 顯示錯誤，沒有表單', async () => {
    details.mockRejectedValue(new Error('AUTH_SSO_INTERACTION_INVALID'));
    renderInteraction();
    expect(await screen.findByTestId('interaction-invalid')).toBeInTheDocument();
    expect(screen.queryByTestId('login-submit')).toBeNull();
  });
});
