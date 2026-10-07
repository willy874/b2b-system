import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { useInteractionLogin } from '../useInteractionLogin';

const { details, login, abort, discover, startExternal, publicSettings } = vi.hoisted(() => ({
  publicSettings: vi.fn(),
  details: vi.fn(),
  login: vi.fn(),
  abort: vi.fn(),
  discover: vi.fn(),
  startExternal: vi.fn(),
}));
vi.mock('@/apis/sso-interaction/get-sso-interaction/query', () => ({
  SSO_INTERACTION_QUERY_KEY: 'SSO_INTERACTION_QUERY_KEY',
  getSsoInteractionQueryOptions: (uid: string) => ({
    queryKey: ['SSO_INTERACTION_QUERY_KEY', uid],
    queryFn: details,
    retry: false,
  }),
}));
vi.mock('@/apis/auth/get-public-settings/query', () => ({
  PUBLIC_SETTINGS_QUERY_KEY: 'PUBLIC_SETTINGS_QUERY_KEY',
  getPublicSettingsQueryOptions: (tenant: string) => ({
    queryKey: ['PUBLIC_SETTINGS_QUERY_KEY', tenant],
    queryFn: () => publicSettings(tenant),
  }),
}));
vi.mock('@/apis/sso-interaction/login-sso-interaction/mutation', () => ({
  getLoginSsoInteractionMutationOptions: () => ({ mutationFn: login }),
}));
vi.mock('@/apis/sso-interaction/abort-sso-interaction/mutation', () => ({
  getAbortSsoInteractionMutationOptions: () => ({ mutationFn: abort }),
}));
vi.mock('@/apis/sso-interaction/discover-sso-interaction/query', () => ({
  SSO_DISCOVERY_QUERY_KEY: 'SSO_DISCOVERY_QUERY_KEY',
  getSsoDiscoveryQueryOptions: (uid: string, email: string) => ({
    queryKey: ['SSO_DISCOVERY_QUERY_KEY', uid, email],
    queryFn: () => discover(email),
    retry: false,
  }),
}));
vi.mock('@/apis/sso-interaction/start-external-sso-interaction/mutation', () => ({
  getStartExternalSsoInteractionMutationOptions: () => ({ mutationFn: startExternal }),
}));

const UID = 'abc12345xyz';
const ACME = { id: '22222222-2222-4222-8222-222222222222', name: 'Acme Azure AD' };
const assign = vi.fn();

function renderLogin(searchError?: string) {
  return renderHook(() => useInteractionLogin(UID, searchError), { wrapper: AllProviders });
}

beforeAll(() => initTestI18n());
beforeEach(() => {
  details.mockReset().mockResolvedValue({
    uid: UID,
    prompt: 'login',
    clientId: 'backstage',
    clientName: 'backstage',
    loginHint: null,
    uiLocales: null,
    tenant: { code: 'acme', name: 'Acme' },
  });
  publicSettings.mockReset().mockResolvedValue({ values: {} });
  login.mockReset().mockResolvedValue({ redirectTo: 'http://localhost/resume' });
  abort.mockReset().mockResolvedValue({ redirectTo: 'http://localhost/resume' });
  discover.mockReset().mockResolvedValue({ provider: null, ssoOnly: false });
  startExternal.mockReset().mockResolvedValue({ redirectTo: 'https://idp.test/authorize' });
  assign.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useInteractionLogin（IdP 登入互動的流程）', () => {
  it('email 離開欄位才探索外部 IdP；不是完整的 email 不查', async () => {
    discover.mockResolvedValue({ provider: ACME, ssoOnly: true });
    const { result } = renderLogin();
    act(() => result.current.discover('alice'));
    expect(discover).not.toHaveBeenCalled();

    act(() => result.current.discover(' alice@acme.test '));
    await waitFor(() => expect(result.current.provider).toEqual(ACME));
    expect(discover).toHaveBeenCalledWith('alice@acme.test');
    expect(result.current.ssoOnly).toBe(true);
  });

  it('密碼登入成功：頂層跳轉到 provider，之後算是跳轉中', async () => {
    const { result } = renderLogin();
    await waitFor(() => expect(result.current.interaction.data).toBeDefined());
    act(() => {
      result.current.form.setFieldValue('email', 'alice@acme.test');
      result.current.form.setFieldValue('password', 'secret');
    });
    await act(() => result.current.form.handleSubmit());
    expect(login.mock.calls[0]?.[0]).toEqual({
      params: { uid: UID, email: 'alice@acme.test', password: 'secret' },
    });
    expect(assign).toHaveBeenCalledWith('http://localhost/resume');
    expect(result.current.redirecting).toBe(true);
  });

  it('網址帶回的錯誤顯示到使用者再試一次為止；送出失敗改顯示那次的錯誤與錯誤碼', async () => {
    login.mockRejectedValue(new AppError('AUTH_INVALID_CREDENTIALS', 401));
    const { result } = renderLogin('AUTH_SSO_EXTERNAL_FAILED');
    expect(result.current.searchError).toBe('AUTH_SSO_EXTERNAL_FAILED');

    act(() => {
      result.current.form.setFieldValue('email', 'alice@acme.test');
      result.current.form.setFieldValue('password', 'wrong');
    });
    await act(() => result.current.form.handleSubmit());
    expect(result.current.searchError).toBeUndefined();
    expect(result.current.formError?.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(result.current.expired).toBe(false);
  });

  it('互動已過期（AUTH_SSO_INTERACTION_INVALID）→ expired，改給「重新開始登入」', async () => {
    startExternal.mockRejectedValue(new AppError('AUTH_SSO_INTERACTION_INVALID', 400));
    discover.mockResolvedValue({ provider: ACME, ssoOnly: false });
    const { result } = renderLogin();
    act(() => result.current.discover('alice@acme.test'));
    await waitFor(() => expect(result.current.provider).toEqual(ACME));
    await act(() => result.current.startExternal());
    expect(startExternal.mock.calls[0]?.[0]).toEqual({
      params: { uid: UID, providerId: ACME.id },
    });
    expect(result.current.expired).toBe(true);
  });

  it('取消：中止互動並跳回 provider', async () => {
    const { result } = renderLogin();
    act(() => result.current.cancel());
    await waitFor(() => expect(abort).toHaveBeenCalled());
    expect(abort.mock.calls[0]?.[0]).toEqual({ params: { uid: UID } });
  });
});
