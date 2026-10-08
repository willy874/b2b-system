import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MFA_OVERVIEW_QUERY_KEY } from '@/apis/mfa/get-mfa-overview/query';

import { mfaSelfApi } from '../mfaSelfApi';

const api = vi.hoisted(() => ({
  overview: vi.fn(),
  start: vi.fn(),
  resend: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
  regenerate: vi.fn(),
}));
vi.mock('@/apis/mfa/get-mfa-overview/fetcher', () => ({ fetchMfaOverviewQuery: api.overview }));
vi.mock('@/apis/mfa/start-mfa-enrollment/fetcher', () => ({
  fetchStartMfaEnrollmentMutation: api.start,
}));
vi.mock('@/apis/mfa/resend-mfa-challenge/fetcher', () => ({
  fetchResendMfaChallengeMutation: api.resend,
}));
vi.mock('@/apis/mfa/confirm-mfa-enrollment/fetcher', () => ({
  fetchConfirmMfaEnrollmentMutation: api.confirm,
}));
vi.mock('@/apis/mfa/remove-mfa-factor/fetcher', () => ({
  fetchRemoveMfaFactorMutation: api.remove,
}));
vi.mock('@/apis/mfa/regenerate-mfa-recovery-codes/fetcher', () => ({
  fetchRegenerateMfaRecoveryCodesMutation: api.regenerate,
}));

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue({ ok: true });
});

describe('mfaSelfApi（帳號設定的多重驗證，docs/architecture/backend/21-mfa.md §7）', () => {
  it('概況的 query key 與 MFA 概況的 query 共用快取，讀取帶 signal', async () => {
    expect(mfaSelfApi.overviewKey).toEqual([MFA_OVERVIEW_QUERY_KEY]);
    const signal = new AbortController().signal;
    await expect(mfaSelfApi.fetchOverview(signal)).resolves.toEqual({ ok: true });
    expect(api.overview).toHaveBeenCalledWith({ params: undefined, signal });
  });

  it('開始註冊、重送驗證碼：參數攤平到 params', async () => {
    await mfaSelfApi.start('totp');
    expect(api.start).toHaveBeenCalledWith({ params: { method: 'totp' } });
    await mfaSelfApi.resend('f1');
    expect(api.resend).toHaveBeenCalledWith({ params: { factorId: 'f1' } });
  });

  it('確認註冊：送出的內容與 factorId 合併', async () => {
    await mfaSelfApi.confirm('f1', { code: '123456' } as never);
    expect(api.confirm).toHaveBeenCalledWith({ params: { factorId: 'f1', code: '123456' } });
  });

  it('移除驗證方式、重新產生備用碼都要密碼', async () => {
    await mfaSelfApi.remove('f1', 'pw');
    expect(api.remove).toHaveBeenCalledWith({ params: { factorId: 'f1', password: 'pw' } });
    await mfaSelfApi.regenerate('pw');
    expect(api.regenerate).toHaveBeenCalledWith({ params: { password: 'pw' } });
  });
});
