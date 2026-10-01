import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { GroupCreateRoute, GroupListRoute } from './routes/pages';

export const GROUP_PAGE = definePageKey('GROUP');
/** 建立對話框是獨立的受管頁面（直接貼網址時要擋下）。 */
export const GROUP_CREATE_PAGE = definePageKey('GROUP_CREATE');

export function registerGroupPagePermissions(): void {
  registerPagePermission(GROUP_PAGE, {
    route: routeBasePath(GroupListRoute), // '/group'
    rule: {
      resource: PermissionResource.GROUP,
      access: [PermissionKey['group:read']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(GROUP_CREATE_PAGE, {
    route: routeBasePath(GroupCreateRoute),
    rule: {
      resource: PermissionResource.GROUP,
      access: [PermissionKey['group:read'], PermissionKey['group:create']],
      match: PermissionMatch.EVERY,
    },
  });
}
