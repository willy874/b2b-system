import type { AppDynamicPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { ORGANIZATION_LOCALE_SCOPE } from './locale';
import { registerOrganizationNavigation } from './navigation';
import { registerOrganizationPagePermissions } from './permission';
import { registerOrganizationRouteLinks } from './routeLinks';
import { registerOrganizationSearch } from './search';
import { registerOrganizationTrashType } from './trash';

/** 可啟用的 feature：由 `app/features.ts` 依租戶的啟用清單安裝（docs/architecture/backend/23-organization.md §6、§10 D3）。 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return (context) => {
    // ── 同步階段 ──
    registerOrganizationPagePermissions();
    registerOrganizationNavigation(); // 側欄與命令面板的入口
    registerOrganizationSearch(); // 命令面板的部門搜尋
    registerOrganizationTrashType(); // 回收桶的「部門」分頁
    registerOrganizationRouteLinks(); // 別的 feature 連到部門的 route id
    const app = context.getInstance();

    return {
      name: 'app-organization-feature-plugin',
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
          { scope: ORGANIZATION_LOCALE_SCOPE },
        );
      },
    };
  };
}
