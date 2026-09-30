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
import { syncPreferencesAcrossTabs, useLocaleStore } from '@/core/store';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

export function i18nPlugin(): AppPluginFactory {
  return () => {
    let stopSync: (() => void) | undefined;
    let offLocale: (() => void) | undefined;
    return {
      name: 'i18n',
      attrs: { i18n, addResourceBundle, changeLanguage },
      onInit: async () => {
        const { locale } = useLocaleStore.getState();
        await initI18n(locale);
        // 表單驗證訊息走語系（`validation.*`），不顯示 Zod 的英文技術字串
        configureZodErrorMap((key, options) => i18n.t(key, options ?? {}));
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
          if (state.locale !== previous.locale && state.locale !== i18n.language) {
            void changeLanguage(state.locale);
          }
        });
      },
      onDestroy: () => {
        offLocale?.();
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
