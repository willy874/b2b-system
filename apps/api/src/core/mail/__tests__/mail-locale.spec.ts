import { describe, expect, it } from 'vitest';

import { DEFAULT_MAIL_LOCALE, MAIL_FOOTER, MAIL_LOCALES, toMailLocale } from '../mail-locale';

describe('toMailLocale（users.locale → 信件語系）', () => {
  it.each([
    ['zh-TW', 'zh-TW'],
    ['en-US', 'en-US'],
  ] as const)('認得的語系 %s 原樣回傳', (value, expected) => {
    expect(toMailLocale(value)).toBe(expected);
  });

  it.each([
    ['不支援的語系', 'ja-JP'],
    ['大小寫不同', 'en-us'],
    ['只有語言', 'en'],
    ['空字串', ''],
    ['null', null],
    ['undefined', undefined],
  ])('%s → 預設語系 zh-TW', (_name, value) => {
    expect(toMailLocale(value)).toBe('zh-TW');
  });

  it('預設語系是支援的語系之一', () => {
    expect(MAIL_LOCALES).toContain(DEFAULT_MAIL_LOCALE);
  });
});

describe('MAIL_FOOTER', () => {
  it.each(MAIL_LOCALES)('%s 有非空的頁尾', (locale) => {
    expect(MAIL_FOOTER[locale].length).toBeGreaterThan(0);
  });
});
