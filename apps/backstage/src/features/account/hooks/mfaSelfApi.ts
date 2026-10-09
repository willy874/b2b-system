import type { MfaSelfApi } from '@b2b-system/web-core/mfa';

import { fetchConfirmMfaEnrollmentMutation } from '@/apis/mfa/confirm-mfa-enrollment/fetcher';
import { fetchMfaOverviewQuery } from '@/apis/mfa/get-mfa-overview/fetcher';
import { MFA_OVERVIEW_QUERY_KEY } from '@/apis/mfa/get-mfa-overview/query';
import { fetchRegenerateMfaRecoveryCodesMutation } from '@/apis/mfa/regenerate-mfa-recovery-codes/fetcher';
import { fetchRemoveMfaFactorMutation } from '@/apis/mfa/remove-mfa-factor/fetcher';
import { fetchResendMfaChallengeMutation } from '@/apis/mfa/resend-mfa-challenge/fetcher';
import { fetchStartMfaEnrollmentMutation } from '@/apis/mfa/start-mfa-enrollment/fetcher';
import { fetchCurrentTenantQuery } from '@/apis/tenant/get-current-tenant/fetcher';
import { redirectToSso } from '@/core/auth/sso';

/** 帳號設定頁的「多重驗證」打的端點（web-core 的 `MfaSecuritySection`，docs/architecture/backend/21-mfa.md §7）。 */
export const mfaSelfApi: MfaSelfApi = {
  overviewKey: [MFA_OVERVIEW_QUERY_KEY],
  fetchOverview: (signal) => fetchMfaOverviewQuery({ params: undefined, signal }),
  start: (method, input) => fetchStartMfaEnrollmentMutation({ params: { method, input } }),
  resend: (factorId) => fetchResendMfaChallengeMutation({ params: { factorId } }),
  confirm: (factorId, submission) =>
    fetchConfirmMfaEnrollmentMutation({ params: { factorId, ...submission } }),
  remove: (factorId, password) => fetchRemoveMfaFactorMutation({ params: { factorId, password } }),
  regenerate: (password) => fetchRegenerateMfaRecoveryCodesMutation({ params: { password } }),
  /**
   * WebAuthn 的憑證綁 apps/platform 的網域：在登入互動裡設定（docs/architecture/backend/21-mfa.md §7.1）。
   * `prompt=login` 要求重新驗證身分（已有的第二步照常要過），完成後回到這一頁。
   */
  enrollElsewhere: (method) => {
    void fetchCurrentTenantQuery({ params: undefined }).then((tenant) =>
      redirectToSso('/profile', tenant.code, { prompt: 'login', mfa_enroll: method }),
    );
  },
};
