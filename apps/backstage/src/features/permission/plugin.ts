import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { PERMISSION_LOCALE_SCOPE } from './locale';
import { registerPermissionNavigation } from './navigation';
import { registerPermissionPagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    registerPermissionPagePermissions();
    registerPermissionNavigation(); // 側欄與命令面板的入口
    const app = context.getInstance();

    return {
      name: 'app-permission-feature-plugin',
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
          { scope: PERMISSION_LOCALE_SCOPE },
        );
      },
    };
  };
}
