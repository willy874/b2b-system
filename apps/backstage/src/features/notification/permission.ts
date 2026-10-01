import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { NotificationEventListRoute, NotificationListRoute } from './routes/pages';

/** 自己的通知：只需要登入，不需要任何權限（ADR-0026 D9）。 */
export const NOTIFICATION_PAGE = definePageKey('NOTIFICATION');

/** 事件管理：與系統設定同性質，沿用 `system:read`／`system:update`（ADR-0028 D10）。 */
export const NOTIFICATION_EVENT_PAGE = definePageKey('NOTIFICATION_EVENT');

export function registerNotificationPagePermissions(): void {
  registerPagePermission(NOTIFICATION_PAGE, {
    route: routeBasePath(NotificationListRoute),
    rule: { access: [], match: PermissionMatch.EVERY },
  });
  // `/notification/events` 是 `/notification` 的子路徑：頁面鍵取前綴最長的那一個
  registerPagePermission(NOTIFICATION_EVENT_PAGE, {
    route: routeBasePath(NotificationEventListRoute),
    rule: {
      resource: PermissionResource.SYSTEM,
      access: [PermissionKey['system:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
