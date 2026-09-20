import { DEFAULT_LANGUAGE, DEFAULT_TIMEZONE } from '@/shared/constants/lang';
import type { Language } from '@/shared/constants/lang';
import { createDictStorage } from '@/shared/storage';
import { create } from '@/shared/store';

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
