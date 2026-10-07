import type { MfaSelfApi } from '@b2b-system/web-core/mfa';

import { fetchConfirmMfaEnrollmentMutation } from '@/apis/mfa/confirm-mfa-enrollment/fetcher';
import { fetchMfaOverviewQuery } from '@/apis/mfa/get-mfa-overview/fetcher';
import { MFA_OVERVIEW_QUERY_KEY } from '@/apis/mfa/get-mfa-overview/query';
import { fetchRegenerateMfaRecoveryCodesMutation } from '@/apis/mfa/regenerate-mfa-recovery-codes/fetcher';
import { fetchRemoveMfaFactorMutation } from '@/apis/mfa/remove-mfa-factor/fetcher';
import { fetchResendMfaChallengeMutation } from '@/apis/mfa/resend-mfa-challenge/fetcher';
import { fetchStartMfaEnrollmentMutation } from '@/apis/mfa/start-mfa-enrollment/fetcher';

/** 帳號設定頁的「兩步驟驗證」打的端點（web-core 的 `MfaSecuritySection`，docs/architecture/backend/21-mfa.md §7）。 */
export const mfaSelfApi: MfaSelfApi = {
  overviewKey: [MFA_OVERVIEW_QUERY_KEY],
  fetchOverview: (signal) => fetchMfaOverviewQuery({ params: undefined, signal }),
  start: (method) => fetchStartMfaEnrollmentMutation({ params: { method } }),
  resend: (factorId) => fetchResendMfaChallengeMutation({ params: { factorId } }),
  confirm: (factorId, submission) =>
    fetchConfirmMfaEnrollmentMutation({ params: { factorId, ...submission } }),
  remove: (factorId, password) => fetchRemoveMfaFactorMutation({ params: { factorId, password } }),
  regenerate: (password) => fetchRegenerateMfaRecoveryCodesMutation({ params: { password } }),
};
