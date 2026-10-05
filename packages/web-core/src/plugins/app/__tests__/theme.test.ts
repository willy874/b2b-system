import { Themes } from '@b2b-system/web-shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hydratePreferences, THEME_KEY, useThemeStore } from '../../../store';
import { themePlugin } from '../theme';

const STORAGE_KEY = `b2b-system:preference:${THEME_KEY}`;

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
