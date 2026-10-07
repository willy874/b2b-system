import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { SecurityMfaRoute } from './routes/pages';

/** 系統設定的「安全性」分頁：MFA 政策（`mfaPolicy:update` 才能修改，docs/architecture/backend/21-mfa.md §6）。 */
export const SECURITY_MFA_PAGE = definePageKey('SECURITY_MFA');

export function registerSecurityPagePermissions(): void {
  registerPagePermission(SECURITY_MFA_PAGE, {
    route: routeBasePath(SecurityMfaRoute),
    rule: {
      resource: PermissionResource.MFA_POLICY,
      access: [PermissionKey['mfaPolicy:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
