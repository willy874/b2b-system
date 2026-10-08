import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MFA_OVERVIEW_QUERY_KEY } from '@/apis/mfa/get-mfa-overview/query';

import { mfaSelfApi } from '../mfaSelfApi';

const { overview, start, resend, confirm, remove, regenerate } = vi.hoisted(() => ({
  overview: vi.fn(),
  start: vi.fn(),
  resend: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
  regenerate: vi.fn(),
}));
vi.mock('@/apis/mfa/get-mfa-overview/fetcher', () => ({ fetchMfaOverviewQuery: overview }));
vi.mock('@/apis/mfa/start-mfa-enrollment/fetcher', () => ({
  fetchStartMfaEnrollmentMutation: start,
}));
vi.mock('@/apis/mfa/resend-mfa-challenge/fetcher', () => ({
  fetchResendMfaChallengeMutation: resend,
}));
vi.mock('@/apis/mfa/confirm-mfa-enrollment/fetcher', () => ({
  fetchConfirmMfaEnrollmentMutation: confirm,
}));
vi.mock('@/apis/mfa/remove-mfa-factor/fetcher', () => ({ fetchRemoveMfaFactorMutation: remove }));
vi.mock('@/apis/mfa/regenerate-mfa-recovery-codes/fetcher', () => ({
  fetchRegenerateMfaRecoveryCodesMutation: regenerate,
}));

beforeEach(() => {
  for (const fn of [overview, start, resend, confirm, remove, regenerate]) {
    fn.mockReset().mockResolvedValue({ ok: true });
  }
});

describe('mfaSelfApi（帳號設定頁的多重驗證打的平台端點，docs/architecture/backend/21-mfa.md §7）', () => {
  it('overview 的快取鍵是平台的 MFA 概覽', () => {
    expect(mfaSelfApi.overviewKey).toEqual([MFA_OVERVIEW_QUERY_KEY]);
  });

  it('fetchOverview 帶上取消訊號', async () => {
    const signal = new AbortController().signal;
    await mfaSelfApi.fetchOverview(signal);
    expect(overview).toHaveBeenCalledWith({ params: undefined, signal });
  });

  it('設定、重寄、確認以方式與 factor 組出參數', async () => {
    await mfaSelfApi.start('totp');
    await mfaSelfApi.resend('f1');
    await mfaSelfApi.confirm('f1', { payload: { code: '123456' } });
    expect(start).toHaveBeenCalledWith({ params: { method: 'totp' } });
    expect(resend).toHaveBeenCalledWith({ params: { factorId: 'f1' } });
    expect(confirm).toHaveBeenCalledWith({
      params: { factorId: 'f1', payload: { code: '123456' } },
    });
  });

  it('移除與重新產生備用碼都帶密碼（再次驗證身分）', async () => {
    await mfaSelfApi.remove('f1', 'secret');
    await mfaSelfApi.regenerate('secret');
    expect(remove).toHaveBeenCalledWith({ params: { factorId: 'f1', password: 'secret' } });
    expect(regenerate).toHaveBeenCalledWith({ params: { password: 'secret' } });
  });
});
