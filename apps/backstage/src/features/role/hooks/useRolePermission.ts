import { useMemo } from 'react';

import { useIsFeatureReady } from '@/core/feature';
import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';
import { TenantFeature } from '@/shared/api-sdk';

import { ROLE_PAGE } from '../permission';

/** 頁面元件只呼叫這一個 hook，不直接碰 usePermission()。 */
export function useRolePermission() {
  const page = usePagePermission(ROLE_PAGE);
  const { can } = usePermission();
  const hasGroups = useIsFeatureReady(TenantFeature.group);

  // 權限沒變時回傳同一個物件（列表的 rows 等 memo 以它或它的欄位為依賴）
  return useMemo(
    () => ({
      ...page,
      /**
       * 是否能進入權限子頁：`role:read` ＋ `permission:read`（docs/architecture/frontend/06-permission.md §7）。
       * 能不能增減由頁面以 `canGrantPermission` 決定，沒有時唯讀；super-admin 角色由呼叫端另外排除。
       */
      canManagePermission: page.canRead && can(PermissionKey['permission:read']),
      /** 是否能授予／移除角色權限 */
      canGrantPermission: can(PermissionKey['role:grantPermission']),
      canViewUsers: can(PermissionKey['user:read']),
      /**
       * 經由群組持有（docs/architecture/iam/01-model.md §9 G4）：要能讀群組；租戶沒有啟用 `group` 時沒有這一欄
       * （docs/architecture/iam/07-groups.md §8）
       */
      canViewGroups: hasGroups && can(PermissionKey['group:read']),
    }),
    [page, can, hasGroups],
  );
}
