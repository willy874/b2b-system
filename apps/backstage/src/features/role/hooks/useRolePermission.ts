import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { ROLE_PAGE } from '../permission';

/** 頁面元件只呼叫這一個 hook，不直接碰 usePermission()。 */
export function useRolePermission() {
  const page = usePagePermission(ROLE_PAGE);
  const { can } = usePermission();

  return {
    ...page,
    /**
     * 是否能進入權限子頁：`role:read` ＋ `permission:read`（docs/architecture/frontend/06-permission.md §7）。
     * 能不能增減由頁面以 `canGrantPermission` 決定，沒有時唯讀；super-admin 角色由呼叫端另外排除。
     */
    canManagePermission: page.canRead && can(PermissionKey['permission:read']),
    /** 是否能授予／移除角色權限 */
    canGrantPermission: can(PermissionKey['role:grantPermission']),
    canViewUsers: can(PermissionKey['user:read']),
    /** 經由群組持有（docs/rbac/01-domain-model.md §9 G4）：要能讀群組 */
    canViewGroups: can(PermissionKey['group:read']),
  };
}
