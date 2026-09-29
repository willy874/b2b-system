import type { AppPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { WORKSPACE_LOCALE_SCOPE } from './locale';
import { registerWorkspacePagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    registerWorkspacePagePermissions();
    const app = context.getInstance();

    return {
      name: 'app-workspace-feature-plugin',
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
          { scope: WORKSPACE_LOCALE_SCOPE },
        );
      },
    };
  };
}
