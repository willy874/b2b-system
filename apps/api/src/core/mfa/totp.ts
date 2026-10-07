import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 4226（HOTP）與 RFC 6238（TOTP），只用 node:crypto（docs/architecture/backend/21-mfa.md §9.1、評估過的方案：不用 otplib）。
 * 預設是各家驗證器 App 都支援的組合：HMAC-SHA1、6 位數、30 秒。
 */

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export interface TotpOptions {
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
}

export const DEFAULT_TOTP_OPTIONS: TotpOptions = { algorithm: 'sha1', digits: 6, period: 30 };

/** seed 的長度：20 bytes（RFC 4226 建議 160 bits，與 SHA-1 的輸出等長）。 */
export const TOTP_SECRET_BYTES = 20;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** 不分大小寫、忽略空白與 `=`；有不合法的字元時拋錯。 */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('不是合法的 base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 新的 seed（base32）。 */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(TOTP_SECRET_BYTES));
}

/** RFC 4226 §5.3：HMAC → dynamic truncation → 取 `digits` 位。 */
export function hotp(
  key: Buffer,
  counter: number,
  digits = DEFAULT_TOTP_OPTIONS.digits,
  algorithm: TotpAlgorithm = DEFAULT_TOTP_OPTIONS.algorithm,
): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(algorithm, key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** 某個時間點的時間步（RFC 6238 §4.2 的 T）。 */
export function totpCounter(atMs: number, period = DEFAULT_TOTP_OPTIONS.period): number {
  return Math.floor(atMs / 1000 / period);
}

export function totp(
  key: Buffer,
  atMs: number,
  options: TotpOptions = DEFAULT_TOTP_OPTIONS,
): string {
  return hotp(key, totpCounter(atMs, options.period), options.digits, options.algorithm);
}

/**
 * 驗證一個碼，容許前後 `window` 個時間步；回傳符合的時間步（給呼叫端存成 `last_used_counter` 防重放），
 * 不符合時回 null。比對是固定時間。
 */
export function verifyTotp(
  key: Buffer,
  code: string,
  atMs: number,
  options: TotpOptions = DEFAULT_TOTP_OPTIONS,
  window = 1,
): number | null {
  if (!new RegExp(`^\\d{${options.digits}}$`).test(code)) return null;
  const current = totpCounter(atMs, options.period);
  const given = Buffer.from(code);
  let matched: number | null = null;
  // 每一步都算完（不提早結束）：回應時間不透露是哪一步符合
  for (let step = -window; step <= window; step += 1) {
    const counter = current + step;
    if (counter < 0) continue;
    const expected = Buffer.from(hotp(key, counter, options.digits, options.algorithm));
    if (timingSafeEqual(expected, given) && matched === null) matched = counter;
  }
  return matched;
}

/** 驗證器 App 掃描的 URI（Key Uri Format）。issuer 與帳號名稱都要 URI 編碼。 */
export function totpUri(input: {
  secret: string;
  issuer: string;
  accountName: string;
  options?: TotpOptions;
}): string {
  const options = input.options ?? DEFAULT_TOTP_OPTIONS;
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.accountName)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: options.algorithm.toUpperCase(),
    digits: String(options.digits),
    period: String(options.period),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
