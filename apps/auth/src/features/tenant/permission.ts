import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { TenantListRoute } from './routes/pages';

/** 租戶管理（清單與詳情）；`tenant:*` 各自對應建立、編輯、刪除。 */
export const TENANT_PAGE = definePageKey('TENANT');

export function registerTenantPagePermissions(): void {
  registerPagePermission(TENANT_PAGE, {
    route: routeBasePath(TenantListRoute),
    rule: {
      resource: PermissionResource.TENANT,
      access: [PermissionKey['tenant:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
