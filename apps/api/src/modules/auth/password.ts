import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

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
 * 第一次呼叫時才計算，之後重複使用同一個雜湊。
 */
let dummyHash: Promise<string> | undefined;

export function getDummyHash(options = DEFAULT_ARGON2_OPTIONS): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-constant-time-login', options);
  return dummyHash;
}

/** 帳號不存在時呼叫：耗時與真正的驗證一致。 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  await verifyPassword(await getDummyHash(), password);
  return false;
}

/**
 * 只要求長度 ≥ 12 ＋ 不在常見密碼字典中。
 * 不強制複雜度組合——NIST SP 800-63B 已移除該建議。
 */
const COMMON_PASSWORDS = new Set([
  'password1234',
  'qwertyuiop12',
  '123456789012',
  'administrator',
  'passwordpassword',
  'letmein12345',
  'welcome12345',
  'iloveyou1234',
  'b2bsystem123',
]);

export const PasswordSchema = z
  .string()
  .min(12, 'AUTH_PASSWORD_WEAK')
  .max(128)
  .refine((password) => !COMMON_PASSWORDS.has(password.toLowerCase()), 'AUTH_PASSWORD_WEAK');

export function generateStrongPassword(length = 24): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}
