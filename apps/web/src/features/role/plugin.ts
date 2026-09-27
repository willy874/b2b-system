import type { AppPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { registerRoleBatchOperations } from './batch';
import { ROLE_LOCALE_SCOPE } from './locale';
import { registerRolePagePermissions } from './permission';
import { registerRolePreferences } from './preference';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段 ──
    registerRolePagePermissions();
    registerRolePreferences(); // 偏好頁的列表註冊表
    registerRoleBatchOperations(); // 批次佇列的操作：任何分頁都可能被交派執行
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
