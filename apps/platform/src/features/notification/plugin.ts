import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { registerHeaderTool } from '@b2b-system/web-core/toolbar';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { registerNotificationBatchOperations } from './batch';
import { NotificationBell } from './components/NotificationBell';
import { NOTIFICATION_LOCALE_SCOPE } from './locale';
import { registerNotificationPagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段：頁面權限與頂列工具都要在第一次 render 之前存在 ──
    registerNotificationPagePermissions();
    registerNotificationBatchOperations(); // 批次佇列的操作：任何分頁都可能被交派執行
    // 放在內建工具（批次佇列 100、即時連線 150、語言 200、主題 300）之後，最靠近帳號選單（同 backstage）
    registerHeaderTool({
      key: 'notification',
      order: 400,
      labelI18nKey: 'notification.label',
      icon: 'bell',
      Component: NotificationBell,
    });
    const app = context.getInstance();

    return {
      name: 'notification-feature-plugin',
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
          { scope: NOTIFICATION_LOCALE_SCOPE },
        );
      },
    };
  };
}
