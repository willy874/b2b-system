import {
  definePageKey,
  PermissionMatch,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { NotificationListRoute } from './routes/pages';

/** 自己的通知：對象是自己，只需要登入。 */
export const NOTIFICATION_PAGE = definePageKey('NOTIFICATION');

export function registerNotificationPagePermissions(): void {
  registerPagePermission(NOTIFICATION_PAGE, {
    route: routeBasePath(NotificationListRoute),
    rule: { access: [], match: PermissionMatch.EVERY },
  });
}
