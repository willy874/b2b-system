import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { AuditLogListRoute } from './routes/pages';

/** 平台稽核；唯讀，只有 `platformAuditLog:read`。 */
export const AUDIT_LOG_PAGE = definePageKey('AUDIT_LOG');

export function registerAuditLogPagePermissions(): void {
  registerPagePermission(AUDIT_LOG_PAGE, {
    route: routeBasePath(AuditLogListRoute),
    rule: {
      resource: PermissionResource.PLATFORM_AUDIT_LOG,
      access: [PermissionKey['platformAuditLog:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
