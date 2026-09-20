import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { AuditLogListRoute } from './routes/pages';

export const AUDIT_LOG_PAGE = definePageKey('AUDIT_LOG');

export function registerAuditLogPagePermissions(): void {
  registerPagePermission(AUDIT_LOG_PAGE, {
    route: routeBasePath(AuditLogListRoute),
    rule: {
      resource: PermissionResource.AUDIT_LOG,
      access: [PermissionKey['auditLog:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
