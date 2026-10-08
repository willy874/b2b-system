import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { ApprovalListRoute, MyApprovalRoute } from './routes/pages';

export const APPROVAL_PAGE = definePageKey('APPROVAL');
/** 「我的審批」：個人範圍，不需要權限（docs/architecture/iam/02-permission-catalog.md §2.20）。 */
export const MY_APPROVAL_PAGE = definePageKey('MY_APPROVAL');

export function registerApprovalPagePermissions(): void {
  registerPagePermission(APPROVAL_PAGE, {
    route: routeBasePath(ApprovalListRoute),
    rule: {
      resource: PermissionResource.APPROVAL,
      access: [PermissionKey['approval:read']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(MY_APPROVAL_PAGE, {
    route: routeBasePath(MyApprovalRoute),
    rule: { access: [], match: PermissionMatch.EVERY },
  });
}
