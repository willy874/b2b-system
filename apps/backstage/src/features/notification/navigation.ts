import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';
import { registerSystemSettingsTab } from '@/core/system-settings';

import { NOTIFICATION_EVENT_PAGE, NOTIFICATION_OVERVIEW_PAGE } from './permission';

/** 側欄的入口；命令面板的「頁面」也列出它（docs/architecture/frontend/18-command-palette.md §2）。 */
export function registerNotificationNavigation(): void {
  registerNavItem({
    pageKey: NOTIFICATION_OVERVIEW_PAGE,
    to: '/notification/all',
    labelKey: 'menu.notificationOverview',
    testId: 'menu-notification-overview',
    icon: 'bell',
    group: NavGroupKey.SYSTEM,
    order: 1000,
  });
}

/** 系統設定的「事件通知」分頁（docs/architecture/frontend/02-plugin-system.md §4.5）；側欄只有「系統設定」一個入口。 */
export function registerNotificationEventTab(): void {
  registerSystemSettingsTab({
    key: 'notification-events',
    pageKey: NOTIFICATION_EVENT_PAGE,
    to: '/system/notification-events',
    labelKey: 'menu.notificationEvent',
    order: 300,
  });
}
