import type { AppDynamicPluginFactory } from '@/core/app';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { WEBHOOK_LOCALE_SCOPE } from './locale';
import { registerWebhookPagePermissions } from './permission';
import { registerWebhookRouteLinks } from './routeLinks';

/** 可啟用的 feature：由 `app/features.ts` 依租戶的啟用清單安裝（docs/adr/0030-webhooks.md D8）。 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return (context) => {
    // ── 同步階段：權限與通知連結的註冊必須在第一次 render 之前完成 ──
    registerWebhookPagePermissions();
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
