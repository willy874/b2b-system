import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { WorkspaceMembersRoute } from './routes/pages';

/** 工作區裡的成員管理（工作區範圍的權限鍵）。 */
export const WORKSPACE_MEMBER_PAGE = definePageKey('WORKSPACE_MEMBER');

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
}
