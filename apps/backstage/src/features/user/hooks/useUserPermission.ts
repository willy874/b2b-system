import { useMemo } from 'react';

import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { USER_PAGE } from '../permission';

export function useUserPermission() {
  const page = usePagePermission(USER_PAGE);
  const { can } = usePermission();

  // 權限沒變時回傳同一個物件（列表的 rows 等 memo 以它或它的欄位為依賴）
  return useMemo(
    () => ({
      ...page,
      canAssignRole: can(PermissionKey['user:assignRole']),
      canResetPassword: can(PermissionKey['user:resetPassword']),
      /** 解鎖與停用共用 user:update */
      canUnlock: page.canUpdate,
      canReadRoles: can(PermissionKey['role:read']),
      /** 所屬群組（docs/rbac/01-domain-model.md §9 G4）：要能讀群組 */
      canReadGroups: can(PermissionKey['group:read']),
      /** 看別人的有效權限與來源（docs/rbac/01-domain-model.md §9 G4b）；看自己不需要 */
      canExplain: can(PermissionKey['authz:explain']),
      /** 檢視、撤銷別人的個人 API token（docs/architecture/06-external-api.md §9.2 D14）：與停用同一個層級 */
      canManageApiTokens: page.canUpdate,
    }),
    [page, can],
  );
}
