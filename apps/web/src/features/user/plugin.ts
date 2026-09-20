import type { AppPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { USER_LOCALE_SCOPE } from './locale';
import { registerUserPagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    registerUserPagePermissions();
    const app = context.getInstance();

    return {
      name: 'app-user-feature-plugin',
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
          { scope: USER_LOCALE_SCOPE },
        );
      },
    };
  };
}
