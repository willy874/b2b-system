import type { AppPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { SERVICE_ACCOUNT_LOCALE_SCOPE } from './locale';
import { registerServiceAccountPagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段 ──
    registerServiceAccountPagePermissions();
    const app = context.getInstance();

    return {
      name: 'app-service-account-feature-plugin',
      // ── 非同步階段：scope 讓語系包隨路由載入 ──
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
          { scope: SERVICE_ACCOUNT_LOCALE_SCOPE },
        );
      },
    };
  };
}
