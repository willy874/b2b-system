import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { ApprovalListRoute } from './routes/pages';

export const APPROVAL_PAGE = definePageKey('APPROVAL');

export function registerApprovalPagePermissions(): void {
  registerPagePermission(APPROVAL_PAGE, {
    route: routeBasePath(ApprovalListRoute),
    rule: {
      resource: PermissionResource.APPROVAL,
      access: [PermissionKey['approval:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
