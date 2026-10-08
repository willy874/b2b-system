import { useMemo } from 'react';

import { useIsFeatureReady } from '@/core/feature';
import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';
import { TenantFeature } from '@/shared/api-sdk';

import { ORG_UNIT_PAGE } from '../permission';

/**
 * 頁面元件只呼叫這一個 hook，不直接比對權限鍵（docs/architecture/backend/23-organization.md §7）。
 * 頁面註冊沒有帶 `resource`（見 `permission.ts`），所以 create／update／delete 在這裡以權限鍵判斷。
 */
export function useOrgUnitPermission() {
  const page = usePagePermission(ORG_UNIT_PAGE);
  const { can } = usePermission();
  const hasDataTransfer = useIsFeatureReady(TenantFeature.dataTransfer);

  // 權限沒變時回傳同一個物件（子元件的 memo 以它或它的欄位為依賴）
  return useMemo(
    () => ({
      ...page,
      canRead: can(PermissionKey['orgUnit:read']),
      canCreate: can(PermissionKey['orgUnit:create']),
      /** 改名、搬移，以及增減成員、設定主管與主要部門 */
      canUpdate: can(PermissionKey['orgUnit:update']),
      canDelete: can(PermissionKey['orgUnit:delete']),
      /** 成員表嵌入使用者，要能讀使用者（後端 `GET /org-units/:id/members` 要 user:read） */
      canViewMembers: can(PermissionKey['user:read']),
      /** 匯出部門與成員要獨立的 `orgUnit:export`（docs/architecture/backend/22-data-transfer.md §13 D11）；租戶沒有啟用 `dataTransfer` 時沒有入口 */
      canExport: hasDataTransfer && can(PermissionKey['orgUnit:export']),
      /** 匯入沿用 create／update：修改模式與成員要 `orgUnit:update` */
      canImport: hasDataTransfer && can(PermissionKey['orgUnit:update']),
      /** 匯入成員要能挑使用者 */
      canImportMembers:
        hasDataTransfer && can(PermissionKey['orgUnit:update']) && can(PermissionKey['user:read']),
    }),
    [page, can, hasDataTransfer],
  );
}
