import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { HOME_LOCALE_SCOPE } from './locale';
import { registerHomeNavigation } from './navigation';
import { registerHomePagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段：權限註冊必須在第一次 render 之前完成 ──
    registerHomePagePermissions();
    registerHomeNavigation(); // 側欄與命令面板的入口
    const app = context.getInstance();

    return {
      name: 'auth-home-feature-plugin',
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
          { scope: HOME_LOCALE_SCOPE },
        );
      },
    };
  };
}
