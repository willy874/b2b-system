import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import {
  NotificationEventListRoute,
  NotificationListRoute,
  NotificationOverviewRoute,
} from './routes/pages';

/** 自己的通知：只需要登入，不需要任何權限（docs/architecture/backend/15-notification.md §12.2 D9）。 */
export const NOTIFICATION_PAGE = definePageKey('NOTIFICATION');

/** 事件管理（系統設定的「事件通知」分頁）：與系統設定同性質，沿用 `system:read`／`system:update`（docs/architecture/backend/16-notification-event.md §9.2 D10）。 */
export const NOTIFICATION_EVENT_PAGE = definePageKey('NOTIFICATION_EVENT');

/** 通知總覽：租戶內所有人的通知（docs/architecture/backend/19-announcement.md §9.2 D1、D2）。 */
export const NOTIFICATION_OVERVIEW_PAGE = definePageKey('NOTIFICATION_OVERVIEW');

export function registerNotificationPagePermissions(): void {
  registerPagePermission(NOTIFICATION_PAGE, {
    route: routeBasePath(NotificationListRoute),
    rule: { access: [], match: PermissionMatch.EVERY },
  });
  registerPagePermission(NOTIFICATION_EVENT_PAGE, {
    route: routeBasePath(NotificationEventListRoute),
    rule: {
      resource: PermissionResource.SYSTEM,
      access: [PermissionKey['system:read']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(NOTIFICATION_OVERVIEW_PAGE, {
    route: routeBasePath(NotificationOverviewRoute),
    rule: {
      resource: PermissionResource.NOTIFICATION,
      access: [PermissionKey['notification:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
