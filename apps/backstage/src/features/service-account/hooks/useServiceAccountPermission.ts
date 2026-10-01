import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { SERVICE_ACCOUNT_PAGE } from '../permission';

/** 頁面元件只呼叫這一個 hook，不直接碰 usePermission()。 */
export function useServiceAccountPermission() {
  const page = usePagePermission(SERVICE_ACCOUNT_PAGE);
  const { can, permissions } = usePermission();
  const canReadRoles = can(PermissionKey['role:read']);

  return {
    ...page,
    /** 改角色要能讀角色清單（選項）；指派的角色受反提權限制，後端再檢查 */
    canAssignRole: page.canUpdate && canReadRoles,
    canReadRoles,
    /** 建立與撤銷它的 API token（`serviceAccount:update`；token 的權限受反提權限制） */
    canManageTokens: page.canUpdate,
    /**
     * 建立 token 時可以限縮到的權限鍵：只有自己持有的（ADR-0027 D4，後端會擋超出的）。
     * 以權限鍵本身當名稱：權限目錄要 `permission:read` 才讀得到。
     */
    scopeOptions: [...permissions].toSorted().map((key) => ({ key, label: key })),
  };
}
