import { randomInt, timingSafeEqual } from 'node:crypto';

import type { MfaChallenge, MfaSecrets } from './mfa-method';

/**
 * 由伺服器送出的一次性驗證碼（Email、簡訊、通訊軟體共用；docs/architecture/backend/21-mfa.md §3）：碼在 **送出當下** 產生，
 * challenge 只存 `HMAC(challengeId ‖ code)`——6 位數的純雜湊在 DB 外洩時一秒可窮舉。
 */
export const OTP_CODE_DIGITS = 6;

export function generateOtpCode(digits = OTP_CODE_DIGITS): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

export function otpCodeHash(secrets: MfaSecrets, challengeId: string, code: string): string {
  return secrets.hmac(`${challengeId}:${code}`);
}

/** 比對輸入的碼與 challenge 存的 HMAC；還沒送出（工作還在排隊）時 challenge 沒有碼，任何輸入都不對。 */
export function matchesOtpCode(
  secrets: MfaSecrets,
  challenge: MfaChallenge | null,
  code: string,
): boolean {
  const stored = challenge?.state.codeHash;
  if (!challenge || typeof stored !== 'string') return false;
  const given = Buffer.from(otpCodeHash(secrets, challenge.id, code), 'hex');
  const expected = Buffer.from(stored, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
