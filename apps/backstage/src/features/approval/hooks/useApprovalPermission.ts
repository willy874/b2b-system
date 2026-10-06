import { useMemo } from 'react';

import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { APPROVAL_PAGE } from '../permission';

/**
 * 審批頁的權限 facade。核准等同代為執行該操作，後端除了 `approval:review` 還會檢查
 * 該類型要求的權限（docs/rbac/06-approval.md §3.2）；這裡同步反映，避免按鈕按了才 403。
 */
export function useApprovalPermission() {
  const page = usePagePermission(APPROVAL_PAGE);
  const { can } = usePermission();
  const canReview = can(PermissionKey['approval:review']);

  // 權限沒變時回傳同一個物件（列表的 rows 等 memo 以它或它的欄位為依賴）
  return useMemo(
    () => ({
      ...page,
      canReview,
      /** `user.register`：核准會建立帳號 */
      canApproveRegistration: canReview && can(PermissionKey['user:create']),
      /** 核准註冊時一併指派角色：要能指派、也要讀得到角色選項 */
      canAssignRole: can(PermissionKey['user:assignRole']) && can(PermissionKey['role:read']),
    }),
    [page, can, canReview],
  );
}
