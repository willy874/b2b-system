import type { AppPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { PLATFORM_ADMIN_LOCALE_SCOPE } from './locale';
import { registerPlatformAdminPagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段：權限註冊必須在第一次 render 之前完成 ──
    registerPlatformAdminPagePermissions();
    const app = context.getInstance();

    return {
      name: 'platform-admin-feature-plugin',
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
          { scope: PLATFORM_ADMIN_LOCALE_SCOPE },
        );
      },
    };
  };
}
