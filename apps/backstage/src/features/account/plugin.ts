import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { ACCOUNT_LOCALE_SCOPE } from './locale';
import { registerAccountNavigation } from './navigation';
import { registerAccountPagePermissions } from './permission';
import { registerAccountRouteLinks } from './routeLinks';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    registerAccountPagePermissions();
    registerAccountNavigation(); // 側欄與命令面板的入口
    registerAccountRouteLinks(); // 站內通知等後端連結的 route id
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
