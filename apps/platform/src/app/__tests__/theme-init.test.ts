import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { THEME_KEY, useThemeStore } from '@b2b-system/web-core/store';
import { Themes } from '@b2b-system/web-shared/constants';
import { describe, expect, it } from 'vitest';

const STORAGE_KEY = `b2b-system:preference:${THEME_KEY}`;

describe('public/theme-init.js（首次繪製前的主題）', () => {
  const script = readFileSync(resolve(__dirname, '../../../public/theme-init.js'), 'utf8');

  /** 在隔離的環境執行腳本，回傳它設定的 data-theme。 */
  function run(stored: string | null, systemDark: boolean): string | undefined {
    const dataset: Record<string, string> = {};
    runInNewContext(script, {
      localStorage: { getItem: (key: string) => (key === STORAGE_KEY ? stored : null) },
      window: { matchMedia: () => ({ matches: systemDark }) },
      document: { documentElement: { dataset } },
    });
    return dataset.theme;
  }

  it('讀的是 dictStorage 寫入的同一個鍵與格式', () => {
    useThemeStore.getState().setTheme(Themes.DARK);
    expect(run(localStorage.getItem(STORAGE_KEY), false)).toBe('dark');
    localStorage.clear();
  });

  it.each([
    ['指定淺色', JSON.stringify('light'), true, 'light'],
    ['指定深色', JSON.stringify('dark'), false, 'dark'],
    ['跟隨系統（深）', JSON.stringify('system'), true, 'dark'],
    ['沒存過 → 跟隨系統', null, true, 'dark'],
    ['值損壞 → 跟隨系統', '{not json', false, 'light'],
  ])('%s', (_name, stored, systemDark, expected) => {
    expect(run(stored, systemDark)).toBe(expected);
  });
});
