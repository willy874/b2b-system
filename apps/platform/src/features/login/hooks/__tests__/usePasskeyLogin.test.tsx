import { AppError } from '@b2b-system/web-core/errors';
import type * as WebCoreMfa from '@b2b-system/web-core/mfa';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { usePasskeyLogin } from '../usePasskeyLogin';

const { options, login, authenticatePasskey } = vi.hoisted(() => ({
  options: vi.fn(),
  login: vi.fn(),
  authenticatePasskey: vi.fn(),
}));
vi.mock('@/apis/sso-interaction/passkey-options-sso-interaction/mutation', () => ({
  getPasskeyOptionsSsoInteractionMutationOptions: () => ({ mutationFn: options }),
}));
vi.mock('@/apis/sso-interaction/passkey-login-sso-interaction/mutation', () => ({
  getPasskeyLoginSsoInteractionMutationOptions: () => ({ mutationFn: login }),
}));
vi.mock('@b2b-system/web-core/mfa', async (importOriginal) => ({
  ...(await importOriginal<typeof WebCoreMfa>()),
  authenticatePasskey,
}));

const UID = 'abc12345xyz';
const assign = vi.fn();

beforeAll(() => initTestI18n());
beforeEach(() => {
  options.mockReset().mockResolvedValue({ publicData: { options: { challenge: 'c' } } });
  login.mockReset().mockResolvedValue({ redirectTo: 'https://auth.example.com/resume' });
  authenticatePasskey.mockReset().mockResolvedValue({ id: 'cred-1' });
  vi.stubGlobal('location', { ...globalThis.location, assign });
});
afterEach(() => {
  vi.unstubAllGlobals();
  assign.mockReset();
});

function render() {
  return renderHook(() => usePasskeyLogin(UID), { wrapper: AllProviders });
}

describe('usePasskeyLogin（docs/architecture/04-sso.md §3.6）', () => {
  it('取 challenge → 瀏覽器 API → 送出回應 → 頂層跳轉到 resume 網址', async () => {
    const { result } = render();
    await act(() => result.current.start());
    expect(options.mock.calls[0]?.[0]).toMatchObject({ params: { uid: UID } });
    expect(authenticatePasskey).toHaveBeenCalledWith({ challenge: 'c' });
    expect(login.mock.calls[0]?.[0]).toMatchObject({
      params: { uid: UID, payload: { response: { id: 'cred-1' } } },
    });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://auth.example.com/resume'));
  });

  it('使用者取消 → 顯示取消的原因，不送出', async () => {
    authenticatePasskey.mockRejectedValue(
      Object.assign(new Error('x'), { name: 'NotAllowedError' }),
    );
    const { result } = render();
    await act(() => result.current.start());
    expect(login).not.toHaveBeenCalled();
    expect(result.current.error?.message).toBeTruthy();
    expect(result.current.error?.code).toBeUndefined();
    expect(result.current.pending).toBe(false);
  });

  it('伺服器拒絕（不能用、驗證失敗）→ 帶錯誤碼', async () => {
    login.mockRejectedValue(new AppError('AUTH_PASSKEY_INVALID', 400));
    const { result } = render();
    await act(() => result.current.start());
    await waitFor(() => expect(result.current.error?.code).toBe('AUTH_PASSKEY_INVALID'));
    expect(assign).not.toHaveBeenCalled();
  });

  it('取不到 challenge（平台沒開放）→ 不呼叫瀏覽器 API', async () => {
    options.mockRejectedValue(new AppError('AUTH_PASSKEY_UNAVAILABLE', 400));
    const { result } = render();
    await act(() => result.current.start());
    expect(authenticatePasskey).not.toHaveBeenCalled();
    expect(result.current.error?.code).toBe('AUTH_PASSKEY_UNAVAILABLE');
  });
});
