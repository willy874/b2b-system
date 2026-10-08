import { describe, expect, it } from 'vitest';

import {
  containsContext,
  emailContext,
  generateStrongPassword,
  getDummyHash,
  isCommonPassword,
  PasswordSchema,
} from '../password';

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

describe('generateStrongPassword（管理員建立帳號時的隨機密碼）', () => {
  it('預設 24 字元，只用不易混淆的字元，且通過密碼強度檢查', () => {
    const password = generateStrongPassword();
    expect(password).toHaveLength(24);
    expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9!@#$%^&*]+$/);
    expect(PasswordSchema.safeParse(password).success).toBe(true);
  });

  it('可指定長度，每次產生的結果不同', () => {
    expect(generateStrongPassword(40)).toHaveLength(40);
    expect(generateStrongPassword()).not.toBe(generateStrongPassword());
  });
});

describe('密碼強度的邊界（docs/architecture/backend/04-auth.md §4.2）', () => {
  it.each([
    ['字母只剩一個（太短，不算連續字元）', '9#2k$7!4@8%1', false],
    ['完全沒有字母', '2468!3579@13', false],
    ['字母是單一字元的重複', 'k9k8k7k6k5k4', true],
    ['字母是鍵盤或字母順序的連續片段', 'Hijkl-9182-7!', true],
    ['字母是較長片段的重複、但片段不是常見字根', 'zebu7qhx-zebu8qhx', false],
  ])('%s：%s', (_name, password, weak) => {
    expect(isCommonPassword(password)).toBe(weak);
  });

  it('email 沒有網域時只取帳號名稱', () => {
    expect(emailContext('alice')).toEqual(['alice', 'alice']);
  });
});

describe('getDummyHash（時序攻擊防護）', () => {
  it('同一組參數只計算一次，之後重複使用', async () => {
    const options = { memoryCost: 1024, timeCost: 1 };
    const first = getDummyHash(options);
    expect(getDummyHash(options)).toBe(first);
    await expect(first).resolves.toContain('m=1024,t=1');
  });
});
