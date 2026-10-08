import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { OrganizationRoute } from './routes/pages';

export const ORG_UNIT_PAGE = definePageKey('ORG_UNIT');

export function registerOrganizationPagePermissions(): void {
  // 不帶 `resource`：app 的 `PermissionResource` 還沒有 `orgUnit`，create／update／delete 由
  // `useOrgUnitPermission` 直接以權限鍵判斷
  registerPagePermission(ORG_UNIT_PAGE, {
    route: routeBasePath(OrganizationRoute), // '/organization'
    rule: { access: [PermissionKey['orgUnit:read']], match: PermissionMatch.EVERY },
  });
}
