import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { LOGIN_LOCALE_SCOPE } from './locale';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // 登入頁不受權限管轄（未登入即可進入），因此沒有頁面權限註冊。
    const app = context.getInstance();
    return {
      name: 'auth-login-feature-plugin',
      onInit: async () => {
        app.addResourceBundle(
          {
            [Languages.EN_US]: {
              [LanguageNamespace.TRANSLATE]: () => import('./locales/en_US.json'),
            },
            [Languages.ZH_TW]: {
              [LanguageNamespace.TRANSLATE]: () => import('./locales/zh_TW.json'),
            },
          },
          { scope: LOGIN_LOCALE_SCOPE },
        );
      },
    };
  };
}
