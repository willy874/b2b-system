import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { ServiceAccountCreateRoute, ServiceAccountListRoute } from './routes/pages';

export const SERVICE_ACCOUNT_PAGE = definePageKey('SERVICE_ACCOUNT');
/** 建立對話框是獨立的受管頁面（直接貼網址時要擋下）。 */
export const SERVICE_ACCOUNT_CREATE_PAGE = definePageKey('SERVICE_ACCOUNT_CREATE');

export function registerServiceAccountPagePermissions(): void {
  registerPagePermission(SERVICE_ACCOUNT_PAGE, {
    route: routeBasePath(ServiceAccountListRoute), // '/service-account'
    rule: {
      resource: PermissionResource.SERVICE_ACCOUNT,
      access: [PermissionKey['serviceAccount:read']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(SERVICE_ACCOUNT_CREATE_PAGE, {
    route: routeBasePath(ServiceAccountCreateRoute),
    rule: {
      resource: PermissionResource.SERVICE_ACCOUNT,
      access: [PermissionKey['serviceAccount:read'], PermissionKey['serviceAccount:create']],
      match: PermissionMatch.EVERY,
    },
  });
}
