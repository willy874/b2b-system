import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { WorkspaceAdminListRoute } from './routes/pages';

/** 平台的工作區管理。 */
export const WORKSPACE_ADMIN_PAGE = definePageKey('WORKSPACE_ADMIN');

export function registerWorkspaceAdminPagePermissions(): void {
  registerPagePermission(WORKSPACE_ADMIN_PAGE, {
    route: routeBasePath(WorkspaceAdminListRoute),
    rule: {
      resource: PermissionResource.WORKSPACE,
      access: [PermissionKey['workspace:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
