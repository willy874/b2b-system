import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { registerPreferenceSection } from '@b2b-system/web-core/preference';
import { registerHeaderTool } from '@b2b-system/web-core/toolbar';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { NotificationBell } from './components/NotificationBell';
import { NotificationPreferenceSection } from './components/NotificationPreferenceSection';
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
    // 偏好頁的「通知」分頁：自己要收哪些通知（docs/architecture/backend/16-notification-event.md §9.2 D15）；排在表格欄位設定（200）之前
    registerPreferenceSection({
      key: 'notification',
      order: 100,
      labelI18nKey: 'notification.preference.title',
      Component: NotificationPreferenceSection,
      localeScope: NOTIFICATION_LOCALE_SCOPE,
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
