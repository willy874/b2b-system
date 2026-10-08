import { useMemo } from 'react';

import { useIsFeatureReady } from '@/core/feature';
import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';
import { TenantFeature } from '@/shared/api-sdk';

import { GROUP_PAGE } from '../permission';

/** 頁面元件只呼叫這一個 hook，不直接碰 usePermission()。 */
export function useGroupPermission() {
  const page = usePagePermission(GROUP_PAGE);
  const { can } = usePermission();
  const hasDataTransfer = useIsFeatureReady(TenantFeature.dataTransfer);

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
      /** 匯出群組與成員要獨立的 `group:export`（docs/architecture/backend/22-data-transfer.md §13 D11）；租戶沒有啟用 `dataTransfer` 時沒有入口 */
      canExport: hasDataTransfer && can(PermissionKey['group:export']),
      /** 匯入沿用 create／update：修改模式與加成員要 `group:update` */
      canImport: hasDataTransfer && page.canUpdate,
      /** 匯入成員要能挑使用者 */
      canImportMembers: hasDataTransfer && page.canUpdate && can(PermissionKey['user:read']),
    }),
    [page, can, hasDataTransfer],
  );
}
