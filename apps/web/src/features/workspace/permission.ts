import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { WorkspaceAdminListRoute, WorkspaceMembersRoute } from './routes/pages';

/** 工作區裡的成員管理（工作區範圍的權限鍵）。 */
export const WORKSPACE_MEMBER_PAGE = definePageKey('WORKSPACE_MEMBER');
/** 平台的工作區管理。 */
export const WORKSPACE_ADMIN_PAGE = definePageKey('WORKSPACE_ADMIN');

export function registerWorkspacePagePermissions(): void {
  registerPagePermission(WORKSPACE_MEMBER_PAGE, {
    route: routeBasePath(WorkspaceMembersRoute),
    rule: {
      resource: PermissionResource.WORKSPACE_MEMBER,
      access: [PermissionKey['workspaceMember:read']],
      match: PermissionMatch.EVERY,
      scope: 'workspace',
    },
  });
  registerPagePermission(WORKSPACE_ADMIN_PAGE, {
    route: routeBasePath(WorkspaceAdminListRoute),
    rule: {
      resource: PermissionResource.WORKSPACE,
      access: [PermissionKey['workspace:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
