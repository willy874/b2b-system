import { describe, expect, it } from 'vitest';

import { findFullWidthPunctuation } from '../../testing/locales';

const sources = import.meta.glob<string>(
  [
    '../../**/*.tsx',
    '../../**/*.ts',
    '!../../**/__tests__/**',
    '!../../**/*.test.*',
    '!../../testing/**',
  ],
  { eager: true, query: '?raw', import: 'default' },
);

describe('web-core 的程式碼裡沒有寫死的中文標點（docs/architecture/frontend/08-i18n.md §6）', () => {
  it('掃得到原始碼（glob 的路徑沒寫錯）', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it('、（）：｜ 只出現在註解與給開發者的錯誤訊息裡', () => {
    expect(findFullWidthPunctuation(sources)).toEqual([]);
  });
});
