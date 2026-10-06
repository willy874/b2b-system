import { describe, expect, it } from 'vitest';

import { resolveLanguage } from '../lang';

describe('resolveLanguage（帳號、瀏覽器、ui_locales 的語系標籤 → 支援的語系）', () => {
  it.each([
    ['en-US', 'en-US'],
    ['EN-us', 'en-US'],
    ['en', 'en-US'],
    ['en-GB', 'en-US'],
    ['zh-TW', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['zh', 'zh-TW'],
  ])('%s → %s', (tag, expected) => {
    expect(resolveLanguage(tag)).toBe(expected);
  });

  it.each([[undefined], [null], [''], ['ja-JP'], ['fr']])('對不到（%s）回傳 undefined', (tag) => {
    expect(resolveLanguage(tag)).toBeUndefined();
  });
});
