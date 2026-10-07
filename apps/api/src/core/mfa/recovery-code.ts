import { createHash, randomInt } from 'node:crypto';

/**
 * 一次性備用碼（docs/architecture/backend/21-mfa.md §3、D15）：10 組、每組 10 個字元的 Crockford base32（約 50 bits），
 * 顯示成 `XXXXX-XXXXX`；資料庫只存 SHA-256。熵夠高，不需要 HMAC 或慢雜湊。
 */

export const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;
/** Crockford base32：去掉 I、L、O、U，避免抄寫時混淆。 */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateRecoveryCode(): string {
  let raw = '';
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i += 1) {
    raw += CROCKFORD_ALPHABET[randomInt(CROCKFORD_ALPHABET.length)];
  }
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(generateRecoveryCode());
  return [...codes];
}

/**
 * 比對前的正規化：去掉連字號與空白、轉大寫，並照 Crockford 的規則把容易抄錯的字換回來（O→0、I／L→1）。
 * 形狀不對時回 null。
 */
export function normalizeRecoveryCode(input: string): string | null {
  const cleaned = input
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (cleaned.length !== RECOVERY_CODE_LENGTH) return null;
  for (const char of cleaned) if (!CROCKFORD_ALPHABET.includes(char)) return null;
  return cleaned;
}

/** 存進資料庫的雜湊（正規化之後）；形狀不對時回 null。 */
export function hashRecoveryCode(input: string): string | null {
  const normalized = normalizeRecoveryCode(input);
  return normalized === null ? null : createHash('sha256').update(normalized).digest('hex');
}
