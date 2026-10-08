import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyAccountPreferences,
  createPreferenceChannel,
  detectBrowserLanguage,
  hydratePreferences,
  syncPreferencesAcrossTabs,
  useHeaderToolbarStore,
  useLocaleStore,
  useThemeStore,
  useTimezoneStore,
} from '../preference';

const LOCALE_KEY = 'b2b-system:preference:locale';
const TIMEZONE_KEY = 'b2b-system:preference:timezone';
const THEME_KEY = 'b2b-system:preference:theme';
const TOOLBAR_KEY = 'b2b-system:preference:headerToolbar';

function stubBrowserLanguages(languages: string[]) {
  vi.stubGlobal('navigator', { ...navigator, languages, language: languages[0] ?? '' });
}

beforeEach(() => {
  localStorage.clear();
  useLocaleStore.setState({ locale: 'zh-TW' });
  useTimezoneStore.setState({ timezone: 'Asia/Taipei' });
  useThemeStore.setState({ theme: 'system' });
  useHeaderToolbarStore.setState({ settings: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('hydratePreferences 的語系來源（docs/architecture/frontend/08-i18n.md §1）', () => {
  it('本機沒有存過 → 用瀏覽器的語系（en-GB 對到 en-US）', () => {
    stubBrowserLanguages(['en-GB', 'zh-TW']);
    hydratePreferences();
    expect(useLocaleStore.getState().locale).toBe('en-US');
  });

  it('瀏覽器的語系都不支援 → 預設的繁中', () => {
    stubBrowserLanguages(['ja-JP', 'fr']);
    hydratePreferences();
    expect(useLocaleStore.getState().locale).toBe('zh-TW');
  });

  it('本機存過 → 以本機為準（之後 profile 回來再以帳號為準）', () => {
    stubBrowserLanguages(['en-US']);
    localStorage.setItem(LOCALE_KEY, JSON.stringify('zh-TW'));
    hydratePreferences();
    expect(useLocaleStore.getState().locale).toBe('zh-TW');
  });

  it('本機存的值不合法 → 略過（語系退回瀏覽器、時區退回預設）', () => {
    stubBrowserLanguages(['en-US']);
    localStorage.setItem(LOCALE_KEY, JSON.stringify('xx-YY'));
    localStorage.setItem(TIMEZONE_KEY, JSON.stringify('Mars/Olympus'));
    hydratePreferences();
    expect(useLocaleStore.getState().locale).toBe('en-US');
    expect(useTimezoneStore.getState().timezone).toBe('Asia/Taipei');
  });
});

describe('applyAccountPreferences（帳號的偏好以帳號為準）', () => {
  it('帳號的語系與時區蓋過本機，並存進本機（下次載入、登入前也用它）', () => {
    applyAccountPreferences({ locale: 'en-US', timezone: 'Europe/Berlin' });
    expect(useLocaleStore.getState().locale).toBe('en-US');
    expect(useTimezoneStore.getState().timezone).toBe('Europe/Berlin');
    expect(JSON.parse(localStorage.getItem(LOCALE_KEY) ?? 'null')).toBe('en-US');
    expect(JSON.parse(localStorage.getItem(TIMEZONE_KEY) ?? 'null')).toBe('Europe/Berlin');
  });

  it('不支援的語系、Intl 不認得的時區不套用', () => {
    applyAccountPreferences({ locale: 'ja-JP', timezone: 'Mars/Olympus' });
    expect(useLocaleStore.getState().locale).toBe('zh-TW');
    expect(useTimezoneStore.getState().timezone).toBe('Asia/Taipei');
  });

  it('與本機相同時不寫入', () => {
    const setLocale = vi.spyOn(useLocaleStore.getState(), 'setLocale');
    applyAccountPreferences({ locale: 'zh-TW', timezone: 'Asia/Taipei' });
    expect(setLocale).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOCALE_KEY)).toBeNull();
  });
});

describe('主題與頂列工具（只存本機）', () => {
  it('setTheme 存進本機，下次載入時水合回來', () => {
    useThemeStore.getState().setTheme('dark');
    expect(JSON.parse(localStorage.getItem(THEME_KEY) ?? 'null')).toBe('dark');

    useThemeStore.setState({ theme: 'light' });
    hydratePreferences();

    expect(useThemeStore.getState().theme).toBe('dark');
  });

  it('本機存的主題或頂列設定不合法時退回預設', () => {
    localStorage.setItem(THEME_KEY, JSON.stringify('neon'));
    localStorage.setItem(TOOLBAR_KEY, JSON.stringify({ order: ['a', 1], hidden: [] }));

    hydratePreferences();

    expect(useThemeStore.getState().theme).toBe('system');
    expect(useHeaderToolbarStore.getState().settings).toBeNull();
  });

  it('頂列設定存進本機並水合；恢復預設時移除', () => {
    const settings = { order: ['search', 'theme'], hidden: ['theme'] };
    useHeaderToolbarStore.getState().setSettings(settings);
    useHeaderToolbarStore.setState({ settings: null });
    hydratePreferences();
    expect(useHeaderToolbarStore.getState().settings).toEqual(settings);

    useHeaderToolbarStore.getState().resetSettings();

    expect(useHeaderToolbarStore.getState().settings).toBeNull();
    expect(localStorage.getItem(TOOLBAR_KEY)).toBeNull();
  });

  it('本機存的合法時區水合回來', () => {
    localStorage.setItem(TIMEZONE_KEY, JSON.stringify('Europe/Berlin'));
    hydratePreferences();
    expect(useTimezoneStore.getState().timezone).toBe('Europe/Berlin');
  });
});

describe('localStorage 拋例外時（私密模式，docs/architecture/frontend/10-testing.md §6）', () => {
  beforeEach(() => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
  });

  it('水合不會丟例外，全部用預設值', () => {
    stubBrowserLanguages(['ja-JP']);
    expect(() => hydratePreferences()).not.toThrow();
    expect(useLocaleStore.getState().locale).toBe('zh-TW');
    expect(useTimezoneStore.getState().timezone).toBe('Asia/Taipei');
    expect(useThemeStore.getState().theme).toBe('system');
    expect(useHeaderToolbarStore.getState().settings).toBeNull();
  });

  it('寫入失敗時這個分頁的設定仍然生效', () => {
    useThemeStore.getState().setTheme('dark');
    useLocaleStore.getState().setLocale('en-US');
    useHeaderToolbarStore.getState().setSettings({ order: [], hidden: [] });
    useHeaderToolbarStore.getState().resetSettings();

    expect(useThemeStore.getState().theme).toBe('dark');
    expect(useLocaleStore.getState().locale).toBe('en-US');
    expect(useHeaderToolbarStore.getState().settings).toBeNull();
  });
});

describe('detectBrowserLanguage', () => {
  it('沒有 navigator.languages 時用 navigator.language', () => {
    vi.stubGlobal('navigator', { language: 'en-US', languages: [] });
    expect(detectBrowserLanguage()).toBe('en-US');
  });
});

describe('syncPreferencesAcrossTabs（其他分頁改了偏好）', () => {
  let otherTab: ReturnType<typeof createPreferenceChannel>;
  let stop: () => void;

  beforeEach(() => {
    otherTab = createPreferenceChannel();
    stop = syncPreferencesAcrossTabs();
  });

  afterEach(() => {
    stop();
    otherTab.close();
  });

  it('語系、時區、主題、頂列設定跟著其他分頁更新', async () => {
    const settings = { order: ['theme'], hidden: [] };
    otherTab.post('set', { key: 'locale', value: 'en-US' });
    otherTab.post('set', { key: 'timezone', value: 'Europe/Berlin' });
    otherTab.post('set', { key: 'theme', value: 'dark' });
    otherTab.post('set', { key: 'headerToolbar', value: settings });

    await vi.waitFor(() => {
      expect(useLocaleStore.getState().locale).toBe('en-US');
      expect(useTimezoneStore.getState().timezone).toBe('Europe/Berlin');
      expect(useThemeStore.getState().theme).toBe('dark');
      expect(useHeaderToolbarStore.getState().settings).toEqual(settings);
    });
  });

  it('其他分頁恢復頂列的預設時跟著清掉', async () => {
    useHeaderToolbarStore.setState({ settings: { order: ['a'], hidden: [] } });

    otherTab.post('remove', { key: 'headerToolbar' });

    await vi.waitFor(() => expect(useHeaderToolbarStore.getState().settings).toBeNull());
  });

  it('不合法的值略過（新舊版本並存）', async () => {
    otherTab.post('set', { key: 'locale', value: 'xx-YY' });
    otherTab.post('set', { key: 'timezone', value: 42 });
    otherTab.post('set', { key: 'theme', value: 'neon' });
    otherTab.post('set', { key: 'headerToolbar', value: { order: 'a' } });
    // 最後送一個合法的值當作「前面的訊息都處理完了」的記號
    otherTab.post('set', { key: 'theme', value: 'light' });

    await vi.waitFor(() => expect(useThemeStore.getState().theme).toBe('light'));
    expect(useLocaleStore.getState().locale).toBe('zh-TW');
    expect(useTimezoneStore.getState().timezone).toBe('Asia/Taipei');
    expect(useHeaderToolbarStore.getState().settings).toBeNull();
  });

  it('停止同步之後不再更新', async () => {
    stop();
    const marker = createPreferenceChannel();
    const received = vi.fn();
    marker.on('set', received);

    otherTab.post('set', { key: 'theme', value: 'dark' });

    await vi.waitFor(() => expect(received).toHaveBeenCalled());
    expect(useThemeStore.getState().theme).toBe('system');
    marker.close();
  });
});
