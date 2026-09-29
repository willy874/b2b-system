import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { PermissionListRoute } from './routes';

export const PERMISSION_PAGE = definePageKey('PERMISSION');

export function registerPermissionPagePermissions(): void {
  registerPagePermission(PERMISSION_PAGE, {
    route: routeBasePath(PermissionListRoute),
    rule: {
      resource: PermissionResource.PERMISSION,
      access: [PermissionKey['permission:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
