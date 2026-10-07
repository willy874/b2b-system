import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { TAG_LOCALE_SCOPE } from './locale';
import { registerTagNavigation } from './navigation';
import { registerTagPagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段 ──
    registerTagPagePermissions();
    registerTagNavigation(); // 側欄與命令面板的入口
    const app = context.getInstance();

    return {
      name: 'app-tag-feature-plugin',
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
          { scope: TAG_LOCALE_SCOPE },
        );
      },
    };
  };
}
