import type { AppPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { ACCOUNT_LOCALE_SCOPE } from './locale';
import { registerAccountPagePermissions } from './permission';
import { registerAccountRouteLinks } from './routeLinks';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段：權限註冊必須在第一次 render 之前完成 ──
    registerAccountPagePermissions();
    registerAccountRouteLinks(); // 站內通知等後端連結的 route id
    const app = context.getInstance();

    return {
      name: 'account-feature-plugin',
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
