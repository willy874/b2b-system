import type { AppDynamicPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { SERVICE_ACCOUNT_LOCALE_SCOPE } from './locale';
import { registerServiceAccountNavigation } from './navigation';
import { registerServiceAccountPagePermissions } from './permission';
import { registerServiceAccountRouteLinks } from './routeLinks';
import { registerServiceAccountSearch } from './search';

/**
 * 可啟用的 feature：與對外 API 同屬 `externalApi`，由 `app/features.ts` 依租戶的啟用清單安裝
 * （docs/architecture/06-external-api.md §3.1）。
 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return (context) => {
    // ── 同步階段 ──
    registerServiceAccountPagePermissions();
    registerServiceAccountNavigation(); // 側欄與命令面板的入口
    registerServiceAccountSearch(); // 命令面板的資料搜尋與動作
    registerServiceAccountRouteLinks(); // 別的 feature 與命令面板連到服務帳號頁面的 route id
    const app = context.getInstance();

    return {
      name: 'app-service-account-feature-plugin',
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
          { scope: SERVICE_ACCOUNT_LOCALE_SCOPE },
        );
      },
    };
  };
}
