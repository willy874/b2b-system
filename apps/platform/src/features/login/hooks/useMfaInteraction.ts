import { isAppError } from '@b2b-system/web-core/errors';
import { MFA_RESTART_CODES } from '@b2b-system/web-core/mfa';
import type { MfaSubmission } from '@b2b-system/web-core/mfa';
import { useMutation } from '@tanstack/react-query';

import { getChallengeMfaSsoInteractionMutationOptions } from '@/apis/sso-interaction/challenge-mfa-sso-interaction/mutation';
import { getConfirmMfaEnrollmentSsoInteractionMutationOptions } from '@/apis/sso-interaction/confirm-mfa-enrollment-sso-interaction/mutation';
import { getResendMfaEnrollmentSsoInteractionMutationOptions } from '@/apis/sso-interaction/resend-mfa-enrollment-sso-interaction/mutation';
import { getStartMfaEnrollmentSsoInteractionMutationOptions } from '@/apis/sso-interaction/start-mfa-enrollment-sso-interaction/mutation';
import { getVerifyMfaSsoInteractionMutationOptions } from '@/apis/sso-interaction/verify-mfa-sso-interaction/mutation';

import { followRedirect } from './useSsoInteraction';

/**
 * 登入互動的第二步（docs/architecture/backend/21-mfa.md §4）：web-core 的 `MfaChallengeForm`、`MfaEnrollFlow` 要的函式。
 * 驗證或首次設定成功後頂層跳轉回 provider；首次設定先顯示備用碼，使用者確認後才跳轉（`finishEnrollment`）。
 * 第二步作廢（錯太多次、逾時、帳號被停用）時交給 `onRestart` 回到密碼。
 */
export function useMfaInteraction(uid: string, onRestart: (error: unknown) => void) {
  const challenge = useMutation(getChallengeMfaSsoInteractionMutationOptions());
  const verify = useMutation({
    ...getVerifyMfaSsoInteractionMutationOptions(),
    onSuccess: followRedirect,
  });
  const start = useMutation(getStartMfaEnrollmentSsoInteractionMutationOptions());
  const resend = useMutation(getResendMfaEnrollmentSsoInteractionMutationOptions());
  const confirm = useMutation(getConfirmMfaEnrollmentSsoInteractionMutationOptions());

  return {
    requestChallenge: (factorId: string) => challenge.mutateAsync({ params: { uid, factorId } }),
    verify: async (factorId: string, submission: MfaSubmission) => {
      await verify.mutateAsync({ params: { uid, factorId, ...submission } });
    },
    startEnrollment: (method: string) => start.mutateAsync({ params: { uid, method } }),
    resendEnrollment: (factorId: string) => resend.mutateAsync({ params: { uid, factorId } }),
    confirmEnrollment: async (factorId: string, submission: MfaSubmission) => {
      // resume 網址留在 mutation 的結果：備用碼對話框關掉才跳轉（`finishEnrollment`）
      const result = await confirm.mutateAsync({ params: { uid, factorId, ...submission } });
      return { recoveryCodes: result.recoveryCodes };
    },
    finishEnrollment: () => {
      if (confirm.data) followRedirect(confirm.data);
    },
    /** 第二步作廢：回到密碼。回傳 true 表示已處理（元件不再顯示訊息）。 */
    handleError: (error: unknown): boolean => {
      if (!isAppError(error) || !MFA_RESTART_CODES.has(error.code)) return false;
      onRestart(error);
      return true;
    },
    redirecting: verify.isSuccess,
  };
}
