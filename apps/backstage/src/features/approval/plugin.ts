import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { registerApprovalBatchOperations } from './batch';
import { APPROVAL_LOCALE_SCOPE } from './locale';
import { registerApprovalNavigation } from './navigation';
import { registerApprovalPagePermissions } from './permission';
import { registerApprovalPreferences } from './preference';
import { registerApprovalRouteLinks } from './routeLinks';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    registerApprovalPagePermissions();
    registerApprovalNavigation(); // 側欄與命令面板的入口
    registerApprovalPreferences(); // 偏好頁的列表註冊表
    registerApprovalBatchOperations(); // 批次佇列的操作：任何分頁都可能被交派執行
    registerApprovalRouteLinks(); // 站內通知等後端連結的 route id
    const app = context.getInstance();

    return {
      name: 'app-approval-feature-plugin',
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
          { scope: APPROVAL_LOCALE_SCOPE },
        );
      },
    };
  };
}
