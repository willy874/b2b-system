import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hydratePreferences, THEME_KEY, useThemeStore } from '@/core/store';
import { Themes } from '@/shared/constants/theme';

import { themePlugin } from '../theme';

const STORAGE_KEY = `game-editor:preference:${THEME_KEY}`;

/** 可控的 `prefers-color-scheme: dark`：`setDark()` 會通知已註冊的 change 監聽。 */
function stubSystemScheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      get matches() {
        return dark;
      },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    })),
  );
  return {
    setDark(next: boolean) {
      dark = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

async function install() {
  // plugin 不讀 context，給一個空物件即可
  const plugin = themePlugin()({} as never);
  await plugin.onInit?.();
  return plugin;
}

const appliedTheme = () => document.documentElement.dataset.theme;

describe('themePlugin', () => {
  beforeEach(() => {
    useThemeStore.setState({ theme: Themes.SYSTEM });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('啟動時依偏好設定 data-theme；跟隨系統時看作業系統', async () => {
    stubSystemScheme(true);
    await install();
    expect(appliedTheme()).toBe('dark');
  });

  it('使用者切換主題時立即套用', async () => {
    stubSystemScheme(false);
    await install();
    useThemeStore.getState().setTheme(Themes.DARK);
    expect(appliedTheme()).toBe('dark');
    useThemeStore.getState().setTheme(Themes.LIGHT);
    expect(appliedTheme()).toBe('light');
  });

  it('跟隨系統時，作業系統切換深淺色會跟著變；指定主題時不受影響', async () => {
    const system = stubSystemScheme(false);
    await install();
    system.setDark(true);
    expect(appliedTheme()).toBe('dark');

    useThemeStore.getState().setTheme(Themes.LIGHT);
    system.setDark(false);
    system.setDark(true);
    expect(appliedTheme()).toBe('light');
  });

  it('onDestroy 解除作業系統的監聽', async () => {
    const system = stubSystemScheme(false);
    const plugin = await install();
    expect(system.listenerCount()).toBe(1);
    plugin.onDestroy?.();
    expect(system.listenerCount()).toBe(0);
  });

  it('水合時忽略不合法的值，退回跟隨系統', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('sepia'));
    hydratePreferences();
    expect(useThemeStore.getState().theme).toBe(Themes.SYSTEM);

    localStorage.setItem(STORAGE_KEY, JSON.stringify(Themes.DARK));
    hydratePreferences();
    expect(useThemeStore.getState().theme).toBe(Themes.DARK);
  });
});

describe('public/theme-init.js（首次繪製前的主題）', () => {
  const script = readFileSync(resolve(__dirname, '../../../../public/theme-init.js'), 'utf8');

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
