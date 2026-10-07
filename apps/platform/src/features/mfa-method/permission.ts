import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { MfaMethodListRoute } from './routes/pages';

/** MFA 方式的列表；`mfaMethod:update` 才能切換全平台的狀態。 */
export const MFA_METHOD_PAGE = definePageKey('MFA_METHOD');

export function registerMfaMethodPagePermissions(): void {
  registerPagePermission(MFA_METHOD_PAGE, {
    route: routeBasePath(MfaMethodListRoute),
    rule: {
      resource: PermissionResource.MFA_METHOD,
      access: [PermissionKey['mfaMethod:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
