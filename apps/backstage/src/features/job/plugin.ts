import type { AppPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { JOB_LOCALE_SCOPE } from './locale';
import { registerJobPagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    registerJobPagePermissions();
    const app = context.getInstance();

    return {
      name: 'app-job-feature-plugin',
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
          { scope: JOB_LOCALE_SCOPE },
        );
      },
    };
  };
}
