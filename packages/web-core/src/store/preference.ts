import { createChannel } from '@b2b-system/web-shared/channel';
import type { Channel, ChannelOptions } from '@b2b-system/web-shared/channel';
import {
  DEFAULT_LANGUAGE,
  DEFAULT_TIMEZONE,
  resolveLanguage,
  SUPPORTED_LANGUAGES,
} from '@b2b-system/web-shared/constants';
import type { Language } from '@b2b-system/web-shared/constants';
import { DEFAULT_THEME, SUPPORTED_THEMES } from '@b2b-system/web-shared/constants';
import type { ThemePreference } from '@b2b-system/web-shared/constants';
import { isValidTimeZone } from '@b2b-system/web-shared/date';
import { create } from '@b2b-system/web-shared/hooks';
import { createDictStorage } from '@b2b-system/web-shared/storage';
import type { DictStorageMessages } from '@b2b-system/web-shared/storage';

const LOCALE_KEY = 'locale';
const TIMEZONE_KEY = 'timezone';
/**
 * localStorage 的完整鍵是 `b2b-system:preference:theme`；index.html 的內嵌腳本在首次繪製前直接讀它，
 * 改名或改儲存格式時要同步改那段腳本（`theme.test.ts` 會比對）。
 */
export const THEME_KEY = 'theme';
const HEADER_TOOLBAR_KEY = 'headerToolbar';

/**
 * 偏好設定的跨分頁頻道：由 `preference` 的 dictStorage 持有，寫入即廣播。
 * 名稱落在 `ge:store:preference:` 之下：伺服器中繼的白名單（`RELAYABLE_CHANNEL_PREFIXES`）。
 */
export function createPreferenceChannel(options?: ChannelOptions): Channel<DictStorageMessages> {
  return createChannel('store:preference:storage', options);
}

const storage = createDictStorage('preference', { channel: createPreferenceChannel() });

interface LocaleStore {
  locale: Language;
  setLocale: (locale: Language) => void;
}

export const useLocaleStore = create<LocaleStore>((set) => ({
  locale: DEFAULT_LANGUAGE,
  setLocale: (locale) => {
    storage.set(LOCALE_KEY, locale);
    set({ locale });
  },
}));

interface TimezoneStore {
  timezone: string;
  setTimezone: (timezone: string) => void;
}

export const useTimezoneStore = create<TimezoneStore>((set) => ({
  timezone: DEFAULT_TIMEZONE,
  setTimezone: (timezone) => {
    storage.set(TIMEZONE_KEY, timezone);
    set({ timezone });
  },
}));

interface ThemeStore {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

/** 主題只存在本機：屬於「這台裝置的顯示方式」，不同步到帳號。 */
export const useThemeStore = create<ThemeStore>((set) => ({
  theme: DEFAULT_THEME,
  setTheme: (theme) => {
    storage.set(THEME_KEY, theme);
    set({ theme });
  },
}));

/**
 * 頂列工具的順序與隱藏項（`toolbar`）。只記使用者調整過的結果；沒調整過是 `null`，照登記的預設順序全部顯示。
 * `order` 裡沒有的工具（之後才追加的）排在最後、預設顯示，所以不必為新工具遷移已存的設定。
 */
export interface HeaderToolbarSettings {
  order: string[];
  hidden: string[];
}

interface HeaderToolbarStore {
  settings: HeaderToolbarSettings | null;
  setSettings: (settings: HeaderToolbarSettings) => void;
  resetSettings: () => void;
}

/** 與主題相同：屬於這台裝置的顯示方式，只存本機。 */
export const useHeaderToolbarStore = create<HeaderToolbarStore>((set) => ({
  settings: null,
  setSettings: (settings) => {
    storage.set(HEADER_TOOLBAR_KEY, settings);
    set({ settings });
  },
  resetSettings: () => {
    storage.remove(HEADER_TOOLBAR_KEY);
    set({ settings: null });
  },
}));

/**
 * 瀏覽器的語系偏好（`navigator.languages`，依序）對到的第一個支援的語系。
 * 還沒有帳號資料時（登入頁、第一次開啟）用它，再退回預設（docs/architecture/frontend/08-i18n.md §1）。
 */
export function detectBrowserLanguage(): Language | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of tags) {
    const language = resolveLanguage(tag);
    if (language) return language;
  }
  return undefined;
}

/**
 * render 前水合，避免「先閃英文再變中文」。語系：本機存的 → 瀏覽器的語系 → 預設；
 * 帳號存的偏好在 profile 回來之後由 `applyAccountPreferences()` 蓋過（以帳號為準）。
 * 本機存的值可能是舊版本或被手動改過的：不合法就略過。
 */
export function hydratePreferences(): void {
  const locale = storage.get<unknown>(LOCALE_KEY, undefined);
  useLocaleStore.setState({
    locale: isLanguage(locale) ? locale : (detectBrowserLanguage() ?? DEFAULT_LANGUAGE),
  });
  const timezone = storage.get<unknown>(TIMEZONE_KEY, undefined);
  useTimezoneStore.setState({
    timezone:
      typeof timezone === 'string' && isValidTimeZone(timezone) ? timezone : DEFAULT_TIMEZONE,
  });
  const theme = storage.get<unknown>(THEME_KEY, DEFAULT_THEME);
  useThemeStore.setState({ theme: isThemePreference(theme) ? theme : DEFAULT_THEME });
  const toolbar = storage.get<unknown>(HEADER_TOOLBAR_KEY, null);
  useHeaderToolbarStore.setState({
    settings: isHeaderToolbarSettings(toolbar) ? toolbar : null,
  });
}

/** 帳號存的偏好（`GET /auth/profile` 的 `user.preferences`）。 */
export interface AccountPreferences {
  locale?: string | null;
  timezone?: string | null;
}

/**
 * 套用帳號存的語系與時區：本機的偏好與帳號不同時以帳號為準（換電腦、換瀏覽器、清掉網站資料之後仍是自己的設定）。
 * 語系要對得到支援的語系、時區要 `Intl` 認得才套用；有變才寫入（同時存進本機並廣播給其他分頁），
 * 切換 i18n 與日期格式由 i18n plugin 訂閱 store 處理。
 */
export function applyAccountPreferences(preferences: AccountPreferences): void {
  const locale = resolveLanguage(preferences.locale);
  if (locale && locale !== useLocaleStore.getState().locale) {
    useLocaleStore.getState().setLocale(locale);
  }
  const { timezone } = preferences;
  if (timezone && isValidTimeZone(timezone) && timezone !== useTimezoneStore.getState().timezone) {
    useTimezoneStore.getState().setTimezone(timezone);
  }
}

function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}

function isThemePreference(value: unknown): value is ThemePreference {
  return SUPPORTED_THEMES.includes(value as ThemePreference);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isHeaderToolbarSettings(value: unknown): value is HeaderToolbarSettings {
  if (typeof value !== 'object' || value === null) return false;
  const { order, hidden } = value as Record<string, unknown>;
  return isStringArray(order) && isStringArray(hidden);
}

/**
 * 一個分頁改了語系、時區、主題或頂列工具，其他分頁立即跟上：dictStorage 寫入時經頻道廣播，這裡只把收到的值放進 store
 * （發訊方已寫入共用的 localStorage；切換 i18n、套用主題分別由 i18n、theme plugin 訂閱 store 處理）。
 * 其他分頁送來的值無法信任型別（新舊版本並存），不合法就略過。
 */
export function syncPreferencesAcrossTabs(): () => void {
  const offs = [
    storage.subscribe(LOCALE_KEY, (value) => {
      if (isLanguage(value)) useLocaleStore.setState({ locale: value });
    }),
    storage.subscribe(TIMEZONE_KEY, (value) => {
      if (typeof value === 'string') useTimezoneStore.setState({ timezone: value });
    }),
    storage.subscribe(THEME_KEY, (value) => {
      if (isThemePreference(value)) useThemeStore.setState({ theme: value });
    }),
    // 移除（恢復預設）時收到 undefined
    storage.subscribe(HEADER_TOOLBAR_KEY, (value) => {
      if (value === undefined) useHeaderToolbarStore.setState({ settings: null });
      else if (isHeaderToolbarSettings(value)) useHeaderToolbarStore.setState({ settings: value });
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
