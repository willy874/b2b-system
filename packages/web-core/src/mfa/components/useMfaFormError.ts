import { useCountdown } from '@b2b-system/web-shared/hooks';
import { useState } from 'react';

import { ErrorCodes, isAppError, useErrorMessage } from '../../errors';
import { useTranslation } from '../../locales';
import type { MfaFormError } from '../registry';

/** 第二步作廢、要從密碼重新開始的錯誤（docs/architecture/backend/21-mfa.md §4.2）。 */
export const MFA_RESTART_CODES: ReadonlySet<string> = new Set([
  'AUTH_MFA_TOO_MANY_ATTEMPTS',
  'AUTH_MFA_PENDING_INVALID',
  'AUTH_SSO_INTERACTION_INVALID',
]);

/**
 * 送出失敗的訊息；限流（429）時倒數到可以再試為止（重寄的冷卻也是 429，`details.retryAfterSeconds`）。
 */
export function useMfaFormError() {
  const toMessage = useErrorMessage();
  const { t } = useTranslation();
  const retry = useCountdown();
  const [error, setError] = useState<MfaFormError & { retryable?: boolean }>();

  const fail = (cause: unknown) => {
    const retryAfter =
      isAppError(cause) && cause.code === ErrorCodes.RATE_LIMITED
        ? cause.retryAfterSeconds
        : undefined;
    setError({
      message: toMessage(cause),
      code: isAppError(cause) ? cause.code : undefined,
      retryable: retryAfter !== undefined,
    });
    if (retryAfter !== undefined) retry.start(retryAfter);
  };

  const shown: MfaFormError | undefined = error?.retryable
    ? retry.remaining > 0
      ? { code: error.code, message: t('error.rate_limited_retry', { count: retry.remaining }) }
      : undefined
    : error && { code: error.code, message: error.message };

  return { error: shown, fail, clear: () => setError(undefined), retryIn: retry.remaining };
}
