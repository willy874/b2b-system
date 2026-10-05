import type { AppPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { registerUserBatchOperations } from './batch';
import { USER_LOCALE_SCOPE } from './locale';
import { registerUserPagePermissions } from './permission';
import { registerUserPreferences } from './preference';
import { registerUserRouteLinks } from './routeLinks';
import { registerUserTrashType } from './trash';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    registerUserPagePermissions();
    registerUserPreferences(); // 偏好頁的列表註冊表
    registerUserBatchOperations(); // 批次佇列的操作：任何分頁都可能被交派執行
    registerUserTrashType(); // 回收桶的「使用者」分頁
    registerUserRouteLinks(); // 別的 feature 連到使用者頁面的 route id
    const app = context.getInstance();

    return {
      name: 'app-user-feature-plugin',
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
          { scope: USER_LOCALE_SCOPE },
        );
      },
    };
  };
}
