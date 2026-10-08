import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMfaInteraction } from '../useMfaInteraction';

const { challenge, verify, start, resend, confirm } = vi.hoisted(() => ({
  challenge: vi.fn(),
  verify: vi.fn(),
  start: vi.fn(),
  resend: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('@/apis/sso-interaction/challenge-mfa-sso-interaction/fetcher', () => ({
  fetchChallengeMfaSsoInteractionMutation: challenge,
}));
vi.mock('@/apis/sso-interaction/verify-mfa-sso-interaction/fetcher', () => ({
  fetchVerifyMfaSsoInteractionMutation: verify,
}));
vi.mock('@/apis/sso-interaction/start-mfa-enrollment-sso-interaction/fetcher', () => ({
  fetchStartMfaEnrollmentSsoInteractionMutation: start,
}));
vi.mock('@/apis/sso-interaction/resend-mfa-enrollment-sso-interaction/fetcher', () => ({
  fetchResendMfaEnrollmentSsoInteractionMutation: resend,
}));
vi.mock('@/apis/sso-interaction/confirm-mfa-enrollment-sso-interaction/fetcher', () => ({
  fetchConfirmMfaEnrollmentSsoInteractionMutation: confirm,
}));

const UID = 'uid-1';
const RESUME = 'https://auth.example.com/api/oidc/auth/uid-1';

const assign = vi.fn();

function renderMfa() {
  const onRestart = vi.fn();
  const hook = renderHook(() => useMfaInteraction(UID, onRestart), { wrapper: AllProviders });
  return { ...hook, onRestart };
}

beforeEach(() => {
  for (const fn of [challenge, verify, start, resend, confirm, assign]) fn.mockReset();
  vi.stubGlobal('location', { ...window.location, assign });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMfaInteraction（登入互動的第二步，docs/architecture/backend/21-mfa.md §4）', () => {
  it('各個請求都帶上互動的 uid', async () => {
    challenge.mockResolvedValue({ challengeId: 'c1' });
    start.mockResolvedValue({ factorId: 'f1' });
    resend.mockResolvedValue({ challengeId: 'c2' });
    const { result } = renderMfa();

    await act(() => result.current.requestChallenge('f1'));
    await act(() => result.current.startEnrollment('email'));
    await act(() => result.current.resendEnrollment('f1'));

    expect(challenge.mock.calls[0]?.[0]).toEqual({ params: { uid: UID, factorId: 'f1' } });
    expect(start.mock.calls[0]?.[0]).toEqual({ params: { uid: UID, method: 'email' } });
    expect(resend.mock.calls[0]?.[0]).toEqual({ params: { uid: UID, factorId: 'f1' } });
  });

  it('驗證成功 → 頂層跳轉回 provider，redirecting 變成 true', async () => {
    verify.mockResolvedValue({ redirectTo: RESUME });
    const { result } = renderMfa();
    expect(result.current.redirecting).toBe(false);

    await act(() => result.current.verify('f1', { payload: { code: '123456' } }));

    expect(verify.mock.calls[0]?.[0]).toEqual({
      params: { uid: UID, factorId: 'f1', payload: { code: '123456' } },
    });
    expect(assign).toHaveBeenCalledWith(RESUME);
    await waitFor(() => expect(result.current.redirecting).toBe(true));
  });

  it('驗證失敗 → 錯誤交給呼叫端、不跳轉', async () => {
    verify.mockRejectedValue(new AppError('AUTH_MFA_INVALID_CODE', 400));
    const { result } = renderMfa();
    await expect(result.current.verify('f1', { payload: { code: '000000' } })).rejects.toThrow();
    expect(assign).not.toHaveBeenCalled();
    expect(result.current.redirecting).toBe(false);
  });

  it('首次設定：確認後先回傳備用碼，不跳轉；finishEnrollment 才跳轉', async () => {
    confirm.mockResolvedValue({ redirectTo: RESUME, recoveryCodes: ['a', 'b'] });
    const { result } = renderMfa();

    let codes: unknown;
    await act(async () => {
      codes = await result.current.confirmEnrollment('f1', { payload: { code: '123456' } });
    });
    expect(codes).toEqual({ recoveryCodes: ['a', 'b'] });
    expect(confirm.mock.calls[0]?.[0]).toEqual({
      params: { uid: UID, factorId: 'f1', payload: { code: '123456' } },
    });
    expect(assign).not.toHaveBeenCalled();

    // mutation 的結果在下一次 render 才進到 hook；在那之前呼叫不會跳轉
    await waitFor(() => {
      act(() => result.current.finishEnrollment());
      expect(assign).toHaveBeenCalledWith(RESUME);
    });
    expect(assign).toHaveBeenCalledOnce();
  });

  it('還沒確認就 finishEnrollment → 不跳轉', () => {
    const { result } = renderMfa();
    act(() => result.current.finishEnrollment());
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    ['AUTH_MFA_TOO_MANY_ATTEMPTS'],
    ['AUTH_MFA_PENDING_INVALID'],
    ['AUTH_SSO_INTERACTION_INVALID'],
  ])('第二步作廢（%s）→ 交給 onRestart 回到密碼，回傳 true', (code) => {
    const { result, onRestart } = renderMfa();
    const error = new AppError(code, 400);
    expect(result.current.handleError(error)).toBe(true);
    expect(onRestart).toHaveBeenCalledWith(error);
  });

  it.each([
    ['一般的錯誤碼', new AppError('AUTH_MFA_INVALID_CODE', 400)],
    ['不是 AppError', new Error('network')],
  ])('其他錯誤（%s）→ 不處理，回傳 false', (_label, error) => {
    const { result, onRestart } = renderMfa();
    expect(result.current.handleError(error)).toBe(false);
    expect(onRestart).not.toHaveBeenCalled();
  });
});
