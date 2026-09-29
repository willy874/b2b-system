import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { UserCreateRoute, UserListRoute } from './routes/pages';

export const USER_PAGE = definePageKey('USER');
/** 建立對話框是獨立的受管頁面：auditor 直接貼網址要看到 403，而不是空對話框。 */
export const USER_CREATE_PAGE = definePageKey('USER_CREATE');

export function registerUserPagePermissions(): void {
  registerPagePermission(USER_PAGE, {
    route: routeBasePath(UserListRoute),
    rule: {
      resource: PermissionResource.USER,
      access: [PermissionKey['user:read']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(USER_CREATE_PAGE, {
    route: routeBasePath(UserCreateRoute),
    rule: {
      resource: PermissionResource.USER,
      access: [PermissionKey['user:read'], PermissionKey['user:create']],
      match: PermissionMatch.EVERY,
    },
  });
}
