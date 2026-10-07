import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { TENANT_LOCALE_SCOPE } from './locale';
import { registerTenantNavigation } from './navigation';
import { registerTenantPagePermissions } from './permission';
import { registerTenantPreferences } from './preference';
import { registerTenantRouteLinks } from './routeLinks';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段：權限註冊必須在第一次 render 之前完成 ──
    registerTenantPagePermissions();
    registerTenantNavigation(); // 側欄與命令面板的入口
    registerTenantPreferences(); // 偏好頁的列表註冊表
    registerTenantRouteLinks(); // 站內通知等後端連結的 route id
    const app = context.getInstance();

    return {
      name: 'tenant-feature-plugin',
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
          { scope: TENANT_LOCALE_SCOPE },
        );
      },
    };
  };
}
