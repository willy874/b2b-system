import type { AppPluginFactory } from '@/core/app';
import {
  addResourceBundle,
  changeLanguage,
  configureZodErrorMap,
  GLOBAL_LOCALE_SCOPE,
  i18n,
  initI18n,
  loadLocaleScope,
} from '@/core/locales';
import { syncPreferencesAcrossTabs, useLocaleStore, useTimezoneStore } from '@/core/store';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';
import { setDateTimeDefaults } from '@/shared/date';

export function i18nPlugin(): AppPluginFactory {
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
        // 表單驗證訊息（Zod）走語系檔，驗證當下以目前語系翻譯
        configureZodErrorMap((key, options) => i18n.t(key, options ?? {}) as string);
        addResourceBundle(
          {
            [Languages.EN_US]: {
              [LanguageNamespace.TRANSLATE]: () => import('@/app/locales/en_US.json'),
            },
            [Languages.ZH_TW]: {
              [LanguageNamespace.TRANSLATE]: () => import('@/app/locales/zh_TW.json'),
            },
          },
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

        // 日期時間的顯示跟著偏好的語言與時區（UX-11）；列表等畫面下次渲染時就會套用
        setDateTimeDefaults({ locale, timeZone: useTimezoneStore.getState().timezone });
        offTimezone = useTimezoneStore.subscribe((state) =>
          setDateTimeDefaults({ timeZone: state.timezone }),
        );
      },
      onDestroy: () => {
        offLocale?.();
        offTimezone?.();
        stopSync?.();
      },
    };
  };
}

declare module '@/core/app/context' {
  interface AppPluginProperties {
    i18n: typeof i18n;
    addResourceBundle: typeof addResourceBundle;
    changeLanguage: typeof changeLanguage;
  }
}
