import { registerNavItem } from '@b2b-system/web-core/navigation';

import { NavGroupKey } from '@/core/navigation';

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
  registerNavItem({
    pageKey: NOTIFICATION_EVENT_PAGE,
    to: '/notification/events',
    labelKey: 'menu.notificationEvent',
    testId: 'menu-notification-event',
    icon: 'bell',
    group: NavGroupKey.SYSTEM,
    order: 1100,
  });
}
