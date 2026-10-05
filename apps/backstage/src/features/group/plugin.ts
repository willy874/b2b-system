import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { GROUP_LOCALE_SCOPE } from './locale';
import { registerGroupPagePermissions } from './permission';
import { registerGroupTrashType } from './trash';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段 ──
    registerGroupPagePermissions();
    registerGroupTrashType(); // 回收桶的「群組」分頁
    const app = context.getInstance();

    return {
      name: 'app-group-feature-plugin',
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
          { scope: GROUP_LOCALE_SCOPE },
        );
      },
    };
  };
}
