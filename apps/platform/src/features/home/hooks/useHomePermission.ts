import { useMemo } from 'react';

import { PermissionKey, usePermission } from '@/core/permission';

/** 首頁的區塊：租戶概況需要 `tenant:read`；未水合時不顯示，避免先出現再消失。 */
export function useHomePermission() {
  const { hydrated, can } = usePermission();
  const canViewTenants = hydrated && can(PermissionKey['tenant:read']);
  return useMemo(() => ({ canViewTenants }), [canViewTenants]);
}
