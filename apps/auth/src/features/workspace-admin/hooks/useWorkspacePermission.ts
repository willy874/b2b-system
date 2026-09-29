import { usePagePermission } from '@/core/permission';

import { WORKSPACE_ADMIN_PAGE } from '../permission';

/** 平台的工作區管理頁：`workspace:*` 各自對應建立、編輯（含指定管理員）、刪除。 */
export function useWorkspaceAdminPermission() {
  return usePagePermission(WORKSPACE_ADMIN_PAGE);
}
