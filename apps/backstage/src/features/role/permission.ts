import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { RoleCreateRoute, RoleListRoute } from './routes/pages';

export const ROLE_PAGE = definePageKey('ROLE');
/** 建立對話框是獨立的受管頁面（直接貼網址時要擋下）。 */
export const ROLE_CREATE_PAGE = definePageKey('ROLE_CREATE');

export function registerRolePagePermissions(): void {
  registerPagePermission(ROLE_PAGE, {
    route: routeBasePath(RoleListRoute), // '/role'
    rule: {
      resource: PermissionResource.ROLE,
      access: [PermissionKey['role:read']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(ROLE_CREATE_PAGE, {
    route: routeBasePath(RoleCreateRoute),
    rule: {
      resource: PermissionResource.ROLE,
      access: [PermissionKey['role:read'], PermissionKey['role:create']],
      match: PermissionMatch.EVERY,
    },
  });
}
