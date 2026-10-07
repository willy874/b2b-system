import { describe, expect, it } from 'vitest';

import { containsContext, emailContext, isCommonPassword, PasswordSchema } from '../password';

describe('密碼強度（docs/architecture/backend/04-auth.md §4.2）', () => {
  it.each([
    'password1234',
    'Password12345',
    'Company2026!!',
    'P@ssw0rd2026!',
    'Summer2026!!!',
    'passwordpassword',
    'aaaaaaaaaaaa',
    'abcabcabcabc',
    '123456789012',
    'qwertyuiopas',
    'zyxwvutsrqpo',
    'Welcome@2026!',
    'b2bsystem123',
  ])('常見或有規律的密碼被拒：%s', (password) => {
    expect(isCommonPassword(password)).toBe(true);
    expect(PasswordSchema.safeParse(password).success).toBe(false);
  });

  it.each([
    ['整串在清單裡（長度夠，只靠清單才擋得到）', 'Unbelievable'],
    ['清單裡的字 ＋ 年份與符號', 'Jessica2026!!'],
    ['清單裡本身含數字的密碼 ＋ 符號', '!!killer1!!!'],
    ['替換字元換回之後在清單裡', 'M@tr1x2026!!'],
  ])('SecLists 的常見密碼被拒：%s', (_name, password) => {
    expect(isCommonPassword(password)).toBe(true);
  });

  it.each(['correct-horse-battery', 'RootPassword!2026', 'Tq8#vLm2@xPz', 'my cat eats rice'])(
    '一般的密碼通過：%s',
    (password) => {
      expect(isCommonPassword(password)).toBe(false);
    },
  );

  it('密碼含 email 的帳號名稱、網域名稱或租戶代碼 → 視為弱密碼；短片段不誤判', () => {
    const context = [...emailContext('alice.wang@acme.com'), 'tenant01'];
    expect(context).toEqual(['alice.wang', 'alice', 'wang', 'acme', 'tenant01']);
    expect(containsContext('Alice-Loves-Rice-99', context)).toBe(true);
    expect(containsContext('go-ACME-go-2026!', context)).toBe(true);
    expect(containsContext('Tenant01-Strong!', context)).toBe(true);
    expect(containsContext('Tq8#vLm2@xPz-long', ['ab', undefined])).toBe(false);
  });
});
