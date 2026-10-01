import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { USER_PAGE } from '../permission';

export function useUserPermission() {
  const page = usePagePermission(USER_PAGE);
  const { can } = usePermission();

  return {
    ...page,
    canAssignRole: can(PermissionKey['user:assignRole']),
    canResetPassword: can(PermissionKey['user:resetPassword']),
    /** 解鎖與停用共用 user:update */
    canUnlock: page.canUpdate,
    canReadRoles: can(PermissionKey['role:read']),
    /** 所屬群組（ADR-0024 G4）：要能讀群組 */
    canReadGroups: can(PermissionKey['group:read']),
  };
}
