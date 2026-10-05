import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { AUDIT_LOG_LOCALE_SCOPE } from './locale';
import { registerAuditLogPagePermissions } from './permission';
import { registerAuditLogPreferences } from './preference';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段：權限註冊必須在第一次 render 之前完成 ──
    registerAuditLogPagePermissions();
    registerAuditLogPreferences(); // 偏好頁的列表註冊表
    const app = context.getInstance();

    return {
      name: 'audit-log-feature-plugin',
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
