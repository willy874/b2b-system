import { useMemo } from 'react';

import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { APPROVAL_FLOW_PAGE } from '../permission';

/**
 * 頁面元件只呼叫這一個 hook，不直接碰 usePermission()。
 * 檢視與試算是 `approvalFlow:read`、儲存是 `approvalFlow:update`（docs/architecture/backend/20-approval.md §9.14）；
 * 規則選擇器的選項各自要讀得到使用者、群組、角色、部門。
 */
export function useApprovalFlowPermission() {
  const page = usePagePermission(APPROVAL_FLOW_PAGE);
  const { can } = usePermission();

  // 權限沒變時回傳同一個物件（memo 以它或它的欄位為依賴）
  return useMemo(
    () => ({
      ...page,
      /** 建立、修改、停用流程（受反提權限制，後端另檢查該類型核准所需的權限） */
      canUpdate: page.canAccess && can(PermissionKey['approvalFlow:update']),
      /** 規則「指定使用者」與試算的申請人：伺服器端搜尋使用者 */
      canSearchUsers: can(PermissionKey['user:read']),
      canListGroups: can(PermissionKey['group:read']),
      canListRoles: can(PermissionKey['role:read']),
      canListOrgUnits: can(PermissionKey['orgUnit:read']),
    }),
    [page, can],
  );
}
