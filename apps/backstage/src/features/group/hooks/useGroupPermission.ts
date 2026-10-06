import { useMemo } from 'react';

import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { GROUP_PAGE } from '../permission';

/** 頁面元件只呼叫這一個 hook，不直接碰 usePermission()。 */
export function useGroupPermission() {
  const page = usePagePermission(GROUP_PAGE);
  const { can } = usePermission();

  // 權限沒變時回傳同一個物件（列表的 rows 等 memo 以它或它的欄位為依賴）
  return useMemo(
    () => ({
      ...page,
      /** 讓群組持有角色（受反提權限制；後端仍會再檢查） */
      canAssignRole: can(PermissionKey['group:assignRole']),
      /** 成員清單嵌入使用者，要能讀使用者（後端 `GET /groups/:id/members` 要 user:read） */
      canViewMembers: can(PermissionKey['user:read']),
      /** 持有的角色清單要能讀角色（後端 `GET /groups/:id/roles` 要 role:read） */
      canViewRoles: can(PermissionKey['role:read']),
    }),
    [page, can],
  );
}
