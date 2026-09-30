import {
  definePageKey,
  PermissionMatch,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { NotificationListRoute } from './routes/pages';

/** 自己的通知：只需要登入，不需要任何權限（ADR-0026 D9）。 */
export const NOTIFICATION_PAGE = definePageKey('NOTIFICATION');

export function registerNotificationPagePermissions(): void {
  registerPagePermission(NOTIFICATION_PAGE, {
    route: routeBasePath(NotificationListRoute),
    rule: { access: [], match: PermissionMatch.EVERY },
  });
}
