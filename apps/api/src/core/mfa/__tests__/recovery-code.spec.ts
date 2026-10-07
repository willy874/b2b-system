import { describe, expect, it } from 'vitest';

import {
  generateRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_COUNT,
} from '../recovery-code';

describe('備用碼（docs/architecture/backend/21-mfa.md §3、D15）', () => {
  it('XXXXX-XXXXX，只用 Crockford base32 的字元', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateRecoveryCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    }
  });

  it('一次 10 組、不重複', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
  });

  it('比對前正規化：去掉連字號與空白、轉大寫，O→0、I／L→1', () => {
    expect(normalizeRecoveryCode('abcde-fghjk')).toBe('ABCDEFGHJK');
    expect(normalizeRecoveryCode(' ab cde fghjk ')).toBe('ABCDEFGHJK');
    expect(normalizeRecoveryCode('O0IL1-23456')).toBe('00111' + '23456');
  });

  it('形狀不對回 null', () => {
    expect(normalizeRecoveryCode('ABCDE')).toBeNull();
    expect(normalizeRecoveryCode('ABCDE-FGHJK-1')).toBeNull();
    expect(normalizeRecoveryCode('ABCDE-FGHJU')).toBeNull(); // U 不在字母表
    expect(hashRecoveryCode('nope')).toBeNull();
  });

  it('雜湊以正規化後的碼計算：抄寫的差異不影響比對', () => {
    const code = generateRecoveryCode();
    const hash = hashRecoveryCode(code);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(code.toLowerCase().replace('-', ' '))).toBe(hash);
  });
});
