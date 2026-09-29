import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { WORKSPACE_ADMIN_PAGE, WORKSPACE_MEMBER_PAGE } from '../permission';

/** 成員頁的權限 facade：`workspaceMember:read` 進頁面，指派角色與移除各自一個鍵。 */
export function useWorkspaceMemberPermission() {
  const page = usePagePermission(WORKSPACE_MEMBER_PAGE);
  const { can } = usePermission();
  return {
    ...page,
    canAssignRole: can(PermissionKey['workspaceMember:assignRole']),
    canRemove: can(PermissionKey['workspaceMember:delete']),
  };
}

/** 平台的工作區管理頁：`workspace:*` 各自對應建立、編輯（含指定管理員）、刪除。 */
export function useWorkspaceAdminPermission() {
  return usePagePermission(WORKSPACE_ADMIN_PAGE);
}
