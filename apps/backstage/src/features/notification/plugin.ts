import type { AppPluginFactory } from '@/core/app';
import { registerHeaderTool } from '@/core/toolbar';
import { LanguageNamespace, Languages } from '@/shared/constants/lang';

import { NotificationBell } from './components/NotificationBell';
import { NOTIFICATION_LOCALE_SCOPE } from './locale';
import { registerNotificationPagePermissions } from './permission';

export function appContextPlugin(): AppPluginFactory {
  return (context) => {
    // ── 同步階段：頁面權限與頂列工具都要在第一次 render 之前存在 ──
    registerNotificationPagePermissions();
    // 放在內建工具（批次佇列 100 … 主題 300）之後，最靠近帳號選單
    registerHeaderTool({
      key: 'notification',
      order: 400,
      labelI18nKey: 'notification.label',
      icon: 'bell',
      Component: NotificationBell,
    });
    const app = context.getInstance();

    return {
      name: 'app-notification-feature-plugin',
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
