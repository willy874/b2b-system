import { useMemo } from 'react';

import { PermissionKey, usePagePermission, usePermission } from '@/core/permission';

import { CDN_PAGE } from '../permission';

/**
 * CDN 頁面的權限 facade：`cdn:read` 進頁面與執行檢查，`cdn:update` 改設定，`cdn:purge` 清理，`cdn:purgeAll` 清空整個快取。
 * 權限還沒水合時全部是 false：操作的控制項不會先出現再消失。
 */
export function useCdnPermission() {
  const page = usePagePermission(CDN_PAGE);
  const { can } = usePermission();
  return useMemo(
    () => ({
      ...page,
      canUpdate: can(PermissionKey['cdn:update']),
      canPurge: can(PermissionKey['cdn:purge']),
      canPurgeAll: can(PermissionKey['cdn:purgeAll']),
    }),
    [page, can],
  );
}
