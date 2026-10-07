import type { AppDynamicPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { JOB_LOCALE_SCOPE } from './locale';
import { registerJobNavigation } from './navigation';
import { registerJobPagePermissions } from './permission';

/** 可啟用的 feature：由 `app/features.ts` 依租戶的啟用清單安裝（docs/architecture/frontend/02-plugin-system.md §9.2 D1）。 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return (context) => {
    registerJobPagePermissions();
    registerJobNavigation(); // 側欄與命令面板的入口
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
