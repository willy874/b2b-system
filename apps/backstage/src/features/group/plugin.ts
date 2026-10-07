import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { GROUP_LOCALE_SCOPE } from './locale';
import { registerGroupNavigation } from './navigation';
import { registerGroupPagePermissions } from './permission';
import { registerGroupRouteLinks } from './routeLinks';
import { registerGroupSearch } from './search';
import { registerGroupTrashType } from './trash';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段 ──
    registerGroupPagePermissions();
    registerGroupNavigation(); // 側欄與命令面板的入口
    registerGroupSearch(); // 命令面板的資料搜尋與動作
    registerGroupTrashType(); // 回收桶的「群組」分頁
    registerGroupRouteLinks(); // 別的 feature 連到群組頁面的 route id
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
