import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { GROUP_PAGE } from '../permission';

/** 頁面元件只呼叫這一個 hook，不直接碰 usePermission()。 */
export function useGroupPermission() {
  const page = usePagePermission(GROUP_PAGE);
  const { can } = usePermission();

  return {
    ...page,
    /** 讓群組持有角色（受反提權限制；後端仍會再檢查） */
    canAssignRole: can(PermissionKey['group:assignRole']),
    /** 成員清單嵌入使用者，要能讀使用者（後端 `GET /groups/:id/members` 要 user:read） */
    canViewMembers: can(PermissionKey['user:read']),
    /** 持有的角色清單要能讀角色（後端 `GET /groups/:id/roles` 要 role:read） */
    canViewRoles: can(PermissionKey['role:read']),
  };
}
