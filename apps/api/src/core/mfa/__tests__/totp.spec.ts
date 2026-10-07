import { describe, expect, it } from 'vitest';

import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  totp,
  totpCounter,
  totpUri,
  verifyTotp,
} from '../totp';

const RFC_SHA1_KEY = Buffer.from('12345678901234567890');

describe('HOTP（RFC 4226 附錄 D 的測試向量）', () => {
  it.each([
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ])('counter %i → %s', (counter, expected) => {
    expect(hotp(RFC_SHA1_KEY, counter)).toBe(expected);
  });
});

describe('TOTP（RFC 6238 附錄 B 的測試向量，8 位數）', () => {
  const options = (algorithm: 'sha1' | 'sha256' | 'sha512') => ({
    algorithm,
    digits: 8,
    period: 30,
  });
  const keys = {
    sha1: RFC_SHA1_KEY,
    sha256: Buffer.from('12345678901234567890123456789012'),
    sha512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
  };

  it.each([
    [59, 'sha1', '94287082'],
    [59, 'sha256', '46119246'],
    [59, 'sha512', '90693936'],
    [1111111109, 'sha1', '07081804'],
    [1111111111, 'sha1', '14050471'],
    [1234567890, 'sha1', '89005924'],
    [2000000000, 'sha1', '69279037'],
    [20000000000, 'sha1', '65353130'],
    [20000000000, 'sha256', '77737706'],
    [20000000000, 'sha512', '47863826'],
  ] as const)('T = %i、%s → %s', (seconds, algorithm, expected) => {
    expect(totp(keys[algorithm], seconds * 1000, options(algorithm))).toBe(expected);
  });
});

describe('verifyTotp（docs/architecture/backend/21-mfa.md §9.1）', () => {
  const key = base32Decode(generateTotpSecret());
  const now = Date.UTC(2026, 9, 7, 12, 0, 15);
  const step = totpCounter(now);

  it('接受目前與前後一個時間步，回傳符合的時間步（給框架存成 last_used_counter）', () => {
    expect(verifyTotp(key, hotp(key, step), now)).toBe(step);
    expect(verifyTotp(key, hotp(key, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(key, hotp(key, step + 1), now)).toBe(step + 1);
  });

  it('超過一個時間步不接受', () => {
    expect(verifyTotp(key, hotp(key, step - 2), now)).toBeNull();
    expect(verifyTotp(key, hotp(key, step + 2), now)).toBeNull();
  });

  it('時間步的邊界：同一個 30 秒內的兩個時間點是同一步', () => {
    const start = step * 30_000;
    expect(totpCounter(start)).toBe(step);
    expect(totpCounter(start + 29_999)).toBe(step);
    expect(totpCounter(start + 30_000)).toBe(step + 1);
  });

  it.each(['', '12345', '1234567', 'abcdef', '12 345'])('格式不對（%j）直接不接受', (code) => {
    expect(verifyTotp(key, code, now)).toBeNull();
  });
});

describe('base32 與 otpauth URI', () => {
  it('編碼解碼互逆；解碼不分大小寫、忽略空白與 =', () => {
    const bytes = Buffer.from('hello mfa world!');
    const encoded = base32Encode(bytes);
    expect(base32Decode(encoded)).toEqual(bytes);
    expect(base32Decode(`${encoded.toLowerCase().replace(/(.{4})/g, '$1 ')}==`)).toEqual(bytes);
    expect(() => base32Decode('0189')).toThrow();
  });

  it('seed 是 20 bytes', () => {
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it('URI 帶 issuer 與帳號，並以 URI 編碼', () => {
    const uri = totpUri({ secret: 'ABCD', issuer: 'Acme 公司', accountName: 'a+b@example.com' });
    const url = new URL(uri);
    expect(url.protocol).toBe('otpauth:');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/Acme 公司:a+b@example.com');
    expect(url.searchParams.get('secret')).toBe('ABCD');
    expect(url.searchParams.get('issuer')).toBe('Acme 公司');
    expect(url.searchParams.get('digits')).toBe('6');
  });
});
