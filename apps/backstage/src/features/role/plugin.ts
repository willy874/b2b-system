import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { registerRoleBatchOperations } from './batch';
import { ROLE_LOCALE_SCOPE } from './locale';
import { registerRoleNavigation } from './navigation';
import { registerRolePagePermissions } from './permission';
import { registerRolePreferences } from './preference';
import { registerRoleRouteLinks } from './routeLinks';
import { registerRoleSearch } from './search';
import { registerRoleTrashType } from './trash';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段 ──
    registerRolePagePermissions();
    registerRoleNavigation(); // 側欄與命令面板的入口
    registerRoleSearch(); // 命令面板的資料搜尋與動作
    registerRoleRouteLinks(); // 別的 feature 與命令面板連到角色頁面的 route id
    registerRolePreferences(); // 偏好頁的列表註冊表
    registerRoleBatchOperations(); // 批次佇列的操作：任何分頁都可能被交派執行
    registerRoleTrashType(); // 回收桶的「角色」分頁
    const app = context.getInstance();

    return {
      name: 'app-role-feature-plugin',
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
          { scope: ROLE_LOCALE_SCOPE },
        );
      },
    };
  };
}
