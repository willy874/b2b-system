import { createChannel } from '@/shared/channel';
import type { Channel, ChannelOptions } from '@/shared/channel';
import { DEFAULT_LANGUAGE, DEFAULT_TIMEZONE, SUPPORTED_LANGUAGES } from '@/shared/constants/lang';
import type { Language } from '@/shared/constants/lang';
import { createDictStorage } from '@/shared/storage';
import type { DictStorageMessages } from '@/shared/storage';
import { create } from '@/shared/store';

const LOCALE_KEY = 'locale';
const TIMEZONE_KEY = 'timezone';

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

/** render 前水合，避免「先閃英文再變中文」。 */
export function hydratePreferences(): void {
  useLocaleStore.setState({ locale: storage.get<Language>(LOCALE_KEY, DEFAULT_LANGUAGE) });
  useTimezoneStore.setState({ timezone: storage.get(TIMEZONE_KEY, DEFAULT_TIMEZONE) });
}

function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}

/**
 * 一個分頁改了語系或時區，其他分頁立即跟上：dictStorage 寫入時經頻道廣播，這裡只把收到的值放進 store
 * （發訊方已寫入共用的 localStorage；切換 i18n 由 i18n plugin 訂閱 store 處理）。
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
  ];
  return () => {
    for (const off of offs) off();
  };
}
