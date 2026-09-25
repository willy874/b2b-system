import type { AppPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { APPROVAL_LOCALE_SCOPE } from './locale';
import { registerApprovalPagePermissions } from './permission';
import { registerApprovalPreferences } from './preference';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    registerApprovalPagePermissions();
    registerApprovalPreferences(); // 偏好頁的列表註冊表
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
