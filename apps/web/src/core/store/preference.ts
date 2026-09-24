import { DEFAULT_LANGUAGE, DEFAULT_TIMEZONE } from '@/shared/constants/lang';
import type { Language } from '@/shared/constants/lang';
import { createDictStorage } from '@/shared/storage';
import { create, syncStore } from '@/shared/store';

const storage = createDictStorage('preference');
const LOCALE_KEY = 'locale';
const TIMEZONE_KEY = 'timezone';

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

/**
 * 一個分頁改了語系或時區，其他分頁立即跟上。
 * 收訊方只更新 store：發訊方已寫入共用的 localStorage；切換 i18n 由 i18n plugin 訂閱 store 處理。
 */
export function syncPreferencesAcrossTabs(): () => void {
  const stops = [
    syncStore(useLocaleStore, 'preference:locale', ['locale']),
    syncStore(useTimezoneStore, 'preference:timezone', ['timezone']),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
