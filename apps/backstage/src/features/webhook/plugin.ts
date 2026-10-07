import type { AppDynamicPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { WEBHOOK_LOCALE_SCOPE } from './locale';
import { registerWebhookNavigation } from './navigation';
import { registerWebhookPagePermissions } from './permission';
import { registerWebhookRouteLinks } from './routeLinks';
import { registerWebhookSearch } from './search';

/** 可啟用的 feature：由 `app/features.ts` 依租戶的啟用清單安裝（docs/architecture/backend/17-webhook.md §9.2 D8）。 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return (context) => {
    // ── 同步階段：權限與通知連結的註冊必須在第一次 render 之前完成 ──
    registerWebhookPagePermissions();
    registerWebhookNavigation(); // 側欄與命令面板的入口
    registerWebhookSearch(); // 命令面板的資料搜尋與動作
    registerWebhookRouteLinks(); // 站內通知 webhook.disabled 的連結
    const app = context.getInstance();

    return {
      name: 'webhook-feature-plugin',
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
          { scope: WEBHOOK_LOCALE_SCOPE },
        );
      },
    };
  };
}
