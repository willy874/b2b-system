import type { AppPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { ACCOUNT_LOCALE_SCOPE } from './locale';
import { registerAccountPagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    registerAccountPagePermissions();
    const app = context.getInstance();

    return {
      name: 'app-account-feature-plugin',
      onInit: () => {
        app.addResourceBundle(
          {
            [Languages.EN_US]: {
              [LanguageNamespace.TRANSLATE]: () => import('./locales/en_US.json'),
            },
            [Languages.ZH_TW]: {
              [LanguageNamespace.TRANSLATE]: () => import('./locales/zh_TW.json'),
            },
          },
          { scope: ACCOUNT_LOCALE_SCOPE },
        );
      },
    };
  };
}
