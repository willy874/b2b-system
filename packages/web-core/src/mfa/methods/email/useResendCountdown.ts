import { useCountdown } from '@b2b-system/web-shared/hooks';
import { useEffect } from 'react';

import type { MfaChallengeInfo } from '../../types';

/** 重寄的倒數：伺服器給的 `resendAvailableAt` 之前不能再寄（docs/architecture/backend/21-mfa.md §4.2）。 */
export function useResendCountdown(challenge: MfaChallengeInfo | null): number {
  const countdown = useCountdown();
  const { start } = countdown;
  const availableAt = challenge?.resendAvailableAt;
  useEffect(() => {
    if (!availableAt) return;
    start((new Date(availableAt).getTime() - Date.now()) / 1000);
  }, [availableAt, start]);
  return countdown.remaining;
}
