import { createChannel } from '@/shared/channel';
import type { Channel, ChannelOptions } from '@/shared/channel';
import { DEFAULT_LANGUAGE, DEFAULT_TIMEZONE, SUPPORTED_LANGUAGES } from '@/shared/constants/lang';
import type { Language } from '@/shared/constants/lang';
import { DEFAULT_THEME, SUPPORTED_THEMES } from '@/shared/constants/theme';
import type { ThemePreference } from '@/shared/constants/theme';
import { create } from '@/shared/hooks';
import { createDictStorage } from '@/shared/storage';
import type { DictStorageMessages } from '@/shared/storage';

const LOCALE_KEY = 'locale';
const TIMEZONE_KEY = 'timezone';
/**
 * localStorage 的完整鍵是 `game-editor:preference:theme`；index.html 的內嵌腳本在首次繪製前直接讀它，
 * 改名或改儲存格式時要同步改那段腳本（`theme.test.ts` 會比對）。
 */
export const THEME_KEY = 'theme';

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

/** render 前水合，避免「先閃英文再變中文」。 */
export function hydratePreferences(): void {
  useLocaleStore.setState({ locale: storage.get<Language>(LOCALE_KEY, DEFAULT_LANGUAGE) });
  useTimezoneStore.setState({ timezone: storage.get(TIMEZONE_KEY, DEFAULT_TIMEZONE) });
  const theme = storage.get<unknown>(THEME_KEY, DEFAULT_THEME);
  useThemeStore.setState({ theme: isThemePreference(theme) ? theme : DEFAULT_THEME });
}

function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}

function isThemePreference(value: unknown): value is ThemePreference {
  return SUPPORTED_THEMES.includes(value as ThemePreference);
}

/**
 * 一個分頁改了語系、時區或主題，其他分頁立即跟上：dictStorage 寫入時經頻道廣播，這裡只把收到的值放進 store
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
  ];
  return () => {
    for (const off of offs) off();
  };
}
