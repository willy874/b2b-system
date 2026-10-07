import { createHmac } from 'node:crypto';

import { expect } from '@playwright/test';

/**
 * 驗證器 App 的碼（RFC 6238：HMAC-SHA1、6 位數、30 秒），E2E 以 seed 算碼。演算法與 api 的 `core/mfa/totp.ts` 相同，
 * e2e 不 import api 的原始碼，所以這裡只留算碼的幾行（api 端有 RFC 測試向量守住正確性）。
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function totpCounter(now = Date.now()): number {
  return Math.floor(now / 30_000);
}

export function totpAt(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * 還沒用過的碼：同一個時間步只能用一次（重放保護），上一次用的是 `lastCounter` 時等到下一個時間步。
 * 回傳碼與它的時間步（下一次呼叫帶回來）。
 */
export async function freshTotp(
  secret: string,
  lastCounter = -1,
): Promise<{ code: string; counter: number }> {
  await expect
    .poll(() => totpCounter() > lastCounter, { timeout: 35_000, intervals: [1_000] })
    .toBe(true);
  const counter = totpCounter();
  return { code: totpAt(secret, counter), counter };
}
