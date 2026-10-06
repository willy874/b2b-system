import {
  DEFAULT_LANGUAGE,
  HTML_LANG,
  LanguageNamespace,
  resolveLanguage,
  SUPPORTED_LANGUAGES,
} from '@b2b-system/web-shared/constants';
import type { Language } from '@b2b-system/web-shared/constants';
import { setDateTimeDefaults } from '@b2b-system/web-shared/date';

import type { AppPluginFactory } from '../../app';
import {
  addResourceBundle,
  changeLanguage,
  configureZodErrorMap,
  CORE_LOCALES,
  GLOBAL_LOCALE_SCOPE,
  i18n,
  initI18n,
  loadLocaleScope,
  mergeLocaleImporters,
} from '../../locales';
import type { LocaleImporter } from '../../locales';
import { syncPreferencesAcrossTabs, useLocaleStore, useTimezoneStore } from '../../store';

export interface I18nPluginOptions {
  /** app 自己的全域語系包（與 `CORE_LOCALES` 合併，app 的鍵優先）。 */
  locales: Partial<Record<Language, LocaleImporter>>;
}

/** `<html lang>` 跟著介面語系（報讀器依它選語音，docs/architecture/frontend/08-i18n.md §5）。 */
function applyHtmlLang(language: string): void {
  document.documentElement.lang = HTML_LANG[resolveLanguage(language) ?? DEFAULT_LANGUAGE];
}

export function i18nPlugin({ locales }: I18nPluginOptions): AppPluginFactory {
  return () => {
    let stopSync: (() => void) | undefined;
    let offLocale: (() => void) | undefined;
    let offTimezone: (() => void) | undefined;
    return {
      name: 'i18n',
      attrs: { i18n, addResourceBundle, changeLanguage },
      onInit: async () => {
        const { locale } = useLocaleStore.getState();
        await initI18n(locale);
        applyHtmlLang(i18n.language);
        i18n.on('languageChanged', applyHtmlLang);
        // 表單驗證訊息（Zod）走語系檔，驗證當下以目前語系翻譯
        configureZodErrorMap((key, options) => i18n.t(key, options ?? {}));
        addResourceBundle(
          Object.fromEntries(
            SUPPORTED_LANGUAGES.map((language) => {
              const own = locales[language];
              const importer = own
                ? mergeLocaleImporters(CORE_LOCALES[language], own)
                : CORE_LOCALES[language];
              return [language, { [LanguageNamespace.TRANSLATE]: importer }];
            }),
          ),
          { scope: GLOBAL_LOCALE_SCOPE },
        );
        // 全域語系包必須在首次 render 前就緒
        await loadLocaleScope(GLOBAL_LOCALE_SCOPE, locale);

        // 其他分頁改了語系：store 由跨分頁同步更新，這裡跟著切換
        stopSync = syncPreferencesAcrossTabs();
        offLocale = useLocaleStore.subscribe((state, previous) => {
          if (state.locale !== previous.locale) setDateTimeDefaults({ locale: state.locale });
          if (state.locale !== previous.locale && state.locale !== i18n.language) {
            void changeLanguage(state.locale);
          }
        });

        // 日期時間的顯示跟著偏好的語言與時區；列表等畫面下次渲染時就會套用
        setDateTimeDefaults({ locale, timeZone: useTimezoneStore.getState().timezone });
        offTimezone = useTimezoneStore.subscribe((state) =>
          setDateTimeDefaults({ timeZone: state.timezone }),
        );
      },
      onDestroy: () => {
        i18n.off('languageChanged', applyHtmlLang);
        offLocale?.();
        offTimezone?.();
        stopSync?.();
      },
    };
  };
}

declare module '../../app/context' {
  interface AppPluginProperties {
    i18n: typeof i18n;
    addResourceBundle: typeof addResourceBundle;
    changeLanguage: typeof changeLanguage;
  }
}
