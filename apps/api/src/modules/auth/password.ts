import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

import { WEAK_PASSWORD_ROOTS } from './common-passwords';

/** OWASP Password Storage Cheat Sheet 的 Argon2id 建議值。 */
export interface Argon2Options {
  memoryCost: number;
  timeCost: number;
}

export const DEFAULT_ARGON2_OPTIONS: Argon2Options = { memoryCost: 19_456, timeCost: 2 };

export function hashPassword(password: string, options = DEFAULT_ARGON2_OPTIONS): Promise<string> {
  return hash(password, { ...options, parallelism: 1 });
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password).catch(() => false);
}

/**
 * 帳號不存在時也要跑一次 argon2，讓登入的回應時間一致（時序攻擊防護）。
 * 以 **實際設定的** argon2 參數產生（每組參數第一次呼叫時計算、之後重複使用）：
 * 參數與真正的雜湊不同時，「帳號不存在」與「密碼錯」的耗時就不一樣（docs/issues/02-security.md SEC-14）。
 */
const dummyHashes = new Map<string, Promise<string>>();

export function getDummyHash(options = DEFAULT_ARGON2_OPTIONS): Promise<string> {
  const key = `${options.memoryCost}:${options.timeCost}`;
  let dummy = dummyHashes.get(key);
  if (!dummy) {
    dummy = hashPassword('dummy-password-for-constant-time-login', options);
    dummyHashes.set(key, dummy);
  }
  return dummy;
}

/** 帳號不存在（或沒有密碼）時呼叫：耗時與真正的驗證一致。 */
export async function verifyAgainstDummy(
  password: string,
  options = DEFAULT_ARGON2_OPTIONS,
): Promise<false> {
  await verifyPassword(await getDummyHash(options), password);
  return false;
}

/** 只看整串的常見密碼（剝掉前後綴後字根不在清單裡、但整串很常見的）。 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  'password1234',
  'qwertyuiop12',
  '123456789012',
  'administrator',
  'passwordpassword',
  'letmein12345',
  'welcome12345',
  'iloveyou1234',
  'b2bsystem123',
  '1q2w3e4r5t6y',
  '1qaz2wsx3edc',
]);

/** 鍵盤列與字母順序：整串（或整串反過來）是它們的連續片段就算弱。 */
const SEQUENCES = ['qwertyuiopasdfghjklzxcvbnm', 'abcdefghijklmnopqrstuvwxyz', '01234567890'];

/** 常見的替換字元（`P@ssw0rd` → `password`）。 */
const LEET: Readonly<Record<string, string>> = {
  '@': 'a',
  '4': 'a',
  '3': 'e',
  '1': 'i',
  '!': 'i',
  '0': 'o',
  $: 's',
  '5': 's',
  '7': 't',
};

function isSequential(value: string): boolean {
  if (value.length < 4) return false;
  const reversed = [...value].toReversed().join('');
  return SEQUENCES.some((sequence) => sequence.includes(value) || sequence.includes(reversed));
}

/** 整串由同一個短片段重複組成（`aaaaaaaaaaaa`、`abcabcabcabc`、`passwordpassword`）。 */
function repeatedUnit(value: string): string | undefined {
  for (let size = 1; size <= value.length / 2; size += 1) {
    if (value.length % size !== 0) continue;
    const unit = value.slice(0, size);
    if (unit.repeat(value.length / size) === value) return unit;
  }
  return undefined;
}

function isWeakRoot(letters: string): boolean {
  if (!letters) return false;
  if (WEAK_PASSWORD_ROOTS.has(letters) || isSequential(letters)) return true;
  const unit = repeatedUnit(letters);
  return unit !== undefined && (unit.length <= 3 || WEAK_PASSWORD_ROOTS.has(unit));
}

/**
 * 常見密碼：在清單裡、整串是重複或連續的字元，或是「常見字根 ＋ 數字／年份／符號」
 * （`Password12345`、`Company2026!!`、`P@ssw0rd2026!`）。docs/architecture/backend/04-auth.md §4.2。
 */
export function isCommonPassword(password: string): boolean {
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return true;
  if (repeatedUnit(lower) !== undefined || isSequential(lower)) return true;

  // 去掉前後的數字與符號，再把替換字元換回字母
  const core = lower.replace(/^[^a-z]+|[^a-z]+$/g, '');
  const unleet = [...core]
    .map((char) => LEET[char] ?? char)
    .join('')
    .replace(/[^a-z]/g, '');
  const letters = lower.replace(/[^a-z]/g, '');
  return isWeakRoot(unleet) || isWeakRoot(letters);
}

/**
 * 密碼含有使用者或租戶的識別資訊（email 的帳號部分、網域的主要名稱、租戶代碼）：別人最先猜的就是這些。
 * 只比對長度 ≥ 4 的片段，避免短字誤判。
 */
export function containsContext(
  password: string,
  context: readonly (string | undefined)[],
): boolean {
  const lower = password.toLowerCase();
  return context.some((word) => {
    const normalized = word?.toLowerCase().replace(/[^a-z0-9]/g, '');
    return normalized !== undefined && normalized.length >= 4 && lower.includes(normalized);
  });
}

/** `alice.wang@acme.com` → `['alicewang', 'alice', 'wang', 'acme']`：密碼裡不該出現的片段。 */
export function emailContext(email: string): string[] {
  const [local = '', domain = ''] = email.toLowerCase().split('@');
  const parts = local.split(/[^a-z0-9]+/).filter(Boolean);
  const domainName = domain.split('.')[0];
  return [local, ...parts, ...(domainName ? [domainName] : [])];
}

/**
 * 只要求長度 ≥ 12 ＋ 不是常見密碼。
 * 不強制複雜度組合——NIST SP 800-63B 已移除該建議。
 */
export const PasswordSchema = z
  .string()
  .min(12, 'AUTH_PASSWORD_WEAK')
  .max(128)
  .refine((password) => !isCommonPassword(password), 'AUTH_PASSWORD_WEAK');

export function generateStrongPassword(length = 24): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}
