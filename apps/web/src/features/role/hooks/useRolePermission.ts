import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { ROLE_PAGE } from '../permission';

/** 頁面元件只呼叫這一個 hook，不直接碰 usePermission()。 */
export function useRolePermission() {
  const page = usePagePermission(ROLE_PAGE);
  const { can } = usePermission();

  return {
    ...page,
    /** 是否能進入權限管理子頁（需要能讀權限目錄） */
    canManagePermission: page.canUpdate && can(PermissionKey['permission:read']),
    /** 是否能授予／移除角色權限 */
    canGrantPermission: can(PermissionKey['role:grantPermission']),
    canViewUsers: can(PermissionKey['user:read']),
  };
}
