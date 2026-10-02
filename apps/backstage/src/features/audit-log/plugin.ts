import type { AppDynamicPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { AUDIT_LOG_LOCALE_SCOPE } from './locale';
import { registerAuditLogPagePermissions } from './permission';
import { registerAuditLogPreferences } from './preference';

/** 可啟用的 feature：由 `app/features.ts` 依租戶的啟用清單安裝（docs/architecture/frontend/02-plugin-system.md §9.2 D1）。 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return (context) => {
    registerAuditLogPagePermissions();
    registerAuditLogPreferences(); // 偏好頁的列表註冊表
    const app = context.getInstance();

    return {
      name: 'app-audit-log-feature-plugin',
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
          { scope: AUDIT_LOG_LOCALE_SCOPE },
        );
      },
    };
  };
}
