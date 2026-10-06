import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyAccountPreferences,
  hydratePreferences,
  useLocaleStore,
  useTimezoneStore,
} from '../preference';

const LOCALE_KEY = 'b2b-system:preference:locale';
const TIMEZONE_KEY = 'b2b-system:preference:timezone';

function stubBrowserLanguages(languages: string[]) {
  vi.stubGlobal('navigator', { ...navigator, languages, language: languages[0] ?? '' });
}

beforeEach(() => {
  localStorage.clear();
  useLocaleStore.setState({ locale: 'zh-TW' });
  useTimezoneStore.setState({ timezone: 'Asia/Taipei' });
});

afterEach(() => {
  vi.unstubAllGlobals();
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
